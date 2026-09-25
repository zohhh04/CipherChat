const aiService = require('../services/ai.service');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

async function getChatForUser(chatId, userId) {
  const chat = await Chat.findById(chatId);
  if (!chat) throw ApiError.notFound('Chat not found', 'chat_not_found');
  if (!chat.isMember(userId)) throw ApiError.forbidden('Not a member of this chat', 'not_member');
  return chat;
}

const summarize = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { style = 'brief', limit = 50, messages: clientMessages = [] } = req.body;

  await getChatForUser(id, req.user._id);

  let plainMessages;
  let messageCount = 0;

  // Messages are E2EE — server cannot decrypt. Prefer decrypted texts sent by client.
  if (Array.isArray(clientMessages) && clientMessages.length > 0) {
    plainMessages = clientMessages
      .slice(-Math.min(limit, 100))
      .map((m) => ({
        sender: m.sender || 'User',
        text: m.type && m.type !== 'text' ? `[${m.type}${m.fileName ? `: ${m.fileName}` : ''}]` : (m.text || ''),
      }))
      .filter((m) => m.text && m.text.trim().length > 0);
    messageCount = plainMessages.length;
  } else {
    const messages = await Message.find({ chat: id, deletedAt: null })
      .sort('-_id')
      .limit(Math.min(limit, 100))
      .select('sender type mode text createdAt')
      .lean();

    if (messages.length === 0) {
      return res.json({ ok: true, data: { summary: 'No messages to summarize.' } });
    }

    const senderNames = {};
    const members = (await Chat.findById(id).populate('members.user', 'username')).members || [];
    for (const m of members) {
      if (m.user) senderNames[String(m.user._id)] = m.user.username;
    }

    // 🟢 normal messages have server-side plaintext and can be summarized directly.
    // 🔐 encrypted messages need client plaintext — ask client to send `messages`.
    plainMessages = messages
      .reverse()
      .map((m) => ({
        sender: senderNames[String(m.sender)] || 'User',
        text:
          (m.mode || 'encrypted') === 'normal'
            ? (m.text || (m.type === 'text' ? '' : `[${m.type}]`))
            : (m.type === 'text' ? '' : `[${m.type}]`),
      }))
      .filter((m) => m.text && m.text.trim().length > 0);
    messageCount = plainMessages.length;

    if (plainMessages.length === 0) {
      throw ApiError.badRequest(
        'No readable messages provided. Send decrypted `messages: [{sender, text}]` in the request body (messages are end-to-end encrypted).',
        'messages_required'
      );
    }
  }

  if (plainMessages.length === 0) {
    return res.json({ ok: true, data: { summary: 'No messages to summarize.' } });
  }

  const summary = await aiService.summarize(plainMessages, style);

  res.json({ ok: true, data: { summary, messageCount } });
});

const smartReplies = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { context = '', messages: clientMessages = [] } = req.body;

  await getChatForUser(id, req.user._id);

  let plainMessages;
  if (clientMessages.length > 0) {
    plainMessages = clientMessages.slice(-10).map((m) => ({
      sender: m.sender || 'User',
      text: m.text || '',
    }));
  } else {
    const messages = await Message.find({ chat: id, deletedAt: null })
      .sort('-_id')
      .limit(10)
      .select('sender type mode text createdAt')
      .lean();

    const senderNames = {};
    const members = (await Chat.findById(id).populate('members.user', 'username')).members || [];
    for (const m of members) {
      if (m.user) senderNames[String(m.user._id)] = m.user.username;
    }

    plainMessages = messages.reverse().map((m) => ({
      sender: senderNames[String(m.sender)] || 'User',
      text:
        (m.mode || 'encrypted') === 'normal'
          ? (m.text || (m.type === 'text' ? '' : `[${m.type}]`))
          : (m.type === 'text' ? `[encrypted message]` : `[${m.type}]`),
    }));
  }

  const replies = await aiService.smartReplies(plainMessages, context);

  res.json({ ok: true, data: { replies } });
});

const translate = catchAsync(async (req, res) => {
  const { text, targetLang = 'en' } = req.body;

  if (!text || text.trim().length === 0) {
    throw ApiError.badRequest('Text is required', 'text_required');
  }

  if (text.length > 5000) {
    throw ApiError.badRequest('Text too long (max 5000 chars)', 'text_too_long');
  }

  const translated = await aiService.translate(text, targetLang);

  res.json({ ok: true, data: { translated, sourceLang: 'auto', targetLang } });
});

const detectUrgency = catchAsync(async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    throw ApiError.badRequest('Messages array is required', 'messages_required');
  }

  const plainMessages = messages.slice(0, 20).map((m) => ({
    sender: m.sender || 'User',
    text: m.text || '',
  }));

  const result = await aiService.detectUrgency(plainMessages);

  res.json({ ok: true, data: result });
});

module.exports = { summarize, smartReplies, translate, detectUrgency };
