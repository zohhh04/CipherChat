class PresenceService {
  constructor() {
    this.socketsByUser = new Map();
  }

  add(userId, socketId) {
    const set = this.socketsByUser.get(userId) || new Set();
    set.add(socketId);
    this.socketsByUser.set(userId, set);
    return set.size === 1;
  }

  remove(userId, socketId) {
    const set = this.socketsByUser.get(userId);
    if (!set) return false;
    set.delete(socketId);
    if (set.size === 0) {
      this.socketsByUser.delete(userId);
      return true;
    }
    return false;
  }

  isOnline(userId) {
    return this.socketsByUser.has(String(userId));
  }

  onlineIds() {
    return [...this.socketsByUser.keys()];
  }

  onlineCount() {
    return this.socketsByUser.size;
  }
}

module.exports = { PresenceService };
