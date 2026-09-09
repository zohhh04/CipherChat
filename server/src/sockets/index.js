const { Server } = require('socket.io');
const config = require('../config');
const logger = require('../config/logger');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Notification = require('../models/Notification');
const { verifyAccessToken } = require('../services/token.service');
const { PresenceService } = require('../services/presence.service');
const { NOTIFICATION_TYPES } = require('../utils/constants');

function initSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.clientUrls, credentials: true },
    maxHttpBufferSize: 1e6,
    pingTimeout: 30000,
  });

  const presence = new PresenceService();
  const activeCalls = new Map();

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error('unauthorized'));
      const payload = verifyAccessToken(token);
      const user = await User.findById(payload.sub);
      if (!user || user.isBanned) return next(new Error('unauthorized'));
      socket.data.userId = String(user._id);
      socket.data.username = user.username;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.data.userId;

    const firstConnection = presence.add(userId, socket.id);
    if (firstConnection) {
      await User.updateOne({ _id: userId }, { $set: { lastSeenAt: new Date() } });
      io.emit('presence:update', { userId, online: true });
    }
    socket.join(`user:${userId}`);

    try {
      const chats = await Chat.find({ 'members.user': userId }).select('_id');
      for (const c of chats) socket.join(`chat:${String(c._id)}`);
    } catch (e) {
      logger.warn({ err: e }, 'Failed to join chat rooms');
    }

    socket.on('chat:join', async ({ chatId } = {}) => {
      if (!chatId || !/^[a-f\d]{24}$/i.test(chatId)) return;
      const chat = await Chat.findById(chatId).catch(() => null);
      if (chat && chat.isMember(userId)) socket.join(`chat:${chatId}`);
    });

    socket.on('typing:start', ({ chatId } = {}) => {
      if (!isValidEvent({ chatId })) return;
      socket.to(`chat:${chatId}`).emit('typing', { chatId, userId, username: socket.data.username, typing: true });
    });

    socket.on('typing:stop', ({ chatId } = {}) => {
      if (!isValidEvent({ chatId })) return;
      socket.to(`chat:${chatId}`).emit('typing', { chatId, userId, username: socket.data.username, typing: false });
    });

    socket.on('webrtc:call', ({ to, mediaType } = {}) => {
      if (!isValidEvent({ to }) || !['audio', 'video'].includes(mediaType)) return;
      if (activeCalls.has(to) || activeCalls.has(userId)) {
        io.to(`user:${userId}`).emit('call:busy', { to });
        return;
      }
      activeCalls.set(userId, to);
      activeCalls.set(to, userId);
      io.to(`user:${to}`).emit('call:incoming', { from: userId, fromName: socket.data.username, mediaType });
    });

    socket.on('webrtc:answer', ({ to, accept } = {}) => {
      if (!isValidEvent({ to })) return;
      if (!accept) {
        activeCalls.delete(to);
        activeCalls.delete(userId);
      }
      io.to(`user:${to}`).emit('call:answered', { from: userId, accept: Boolean(accept) });
    });

    socket.on('webrtc:offer', ({ to, sdp } = {}) => {
      if (!isValidEvent({ to }) || typeof sdp !== 'string' || sdp.length > 20000) return;
      io.to(`user:${to}`).emit('call:offer', { from: userId, sdp });
    });

    socket.on('webrtc:answer-sdp', ({ to, sdp } = {}) => {
      if (!isValidEvent({ to }) || typeof sdp !== 'string' || sdp.length > 20000) return;
      io.to(`user:${to}`).emit('call:answer-sdp', { from: userId, sdp });
    });

    socket.on('webrtc:ice', ({ to, candidate } = {}) => {
      if (!isValidEvent({ to })) return;
      io.to(`user:${to}`).emit('call:ice', { from: userId, candidate });
    });

    socket.on('webrtc:end', ({ to } = {}) => {
      if (!isValidEvent({ to })) return;
      activeCalls.delete(to);
      activeCalls.delete(userId);
      io.to(`user:${to}`).emit('call:ended', { from: userId });

      Notification.create({
        user: to,
        actor: userId,
        type: NOTIFICATION_TYPES.CALL,
      }).catch(() => {});
      io.to(`user:${to}`).emit('notification:new', { type: 'call' });
    });

    socket.on('disconnect', async () => {
      const lastOut = presence.remove(userId, socket.id);
      if (lastOut) {
        await User.updateOne({ _id: userId }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
        io.emit('presence:update', { userId, online: false });
      }
    });
  });

  function isValidEvent(obj = {}) {
    if (!obj || typeof obj !== 'object') return false;
    for (const key of ['chatId', 'to']) {
      if (obj[key] !== undefined && !/^[a-f\d]{24}$/i.test(String(obj[key]))) return false;
    }
    return true;
  }

  io.engine.on('connection_error', (err) => {
    logger.warn({ code: err.code, message: err.message }, 'Socket connection error');
  });

  logger.info('Socket.IO initialized');
  return { io, presence };
}

module.exports = { initSockets };
