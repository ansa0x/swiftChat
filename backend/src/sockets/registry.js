// Presence bookkeeping and the outbound emit helper, kept separate from the
// connection handlers so REST controllers can push socket events too without
// importing the socket setup (which would create a cycle).

// userId -> Set of socket ids. A user may hold several sockets at once
// (phone and laptop), so presence is only lost when the last one closes.
const onlineUsers = new Map();

let io = null;

export const setIo = (server) => {
  io = server;
};

export const addSocket = (userId, socketId) => {
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socketId);
  return onlineUsers.get(userId).size;
};

export const removeSocket = (userId, socketId) => {
  const sockets = onlineUsers.get(userId);
  if (!sockets) return 0;

  sockets.delete(socketId);
  if (sockets.size === 0) onlineUsers.delete(userId);

  return sockets.size;
};

export const getOnlineUsers = () => [...onlineUsers.keys()];

export const isUserOnline = (userId) => onlineUsers.has(String(userId));

// Everyone currently connected. Used for changes that are public to any user
// who might be rendering you — a profile photo, for instance.
export const broadcast = (event, payload) => {
  if (!io) return false;
  io.emit(event, payload);
  return true;
};

export const emitToUsers = (userIds, event, payload, exceptSocketId = null) => {
  if (!io) return 0;

  const seen = new Set();
  let delivered = 0;

  for (const userId of userIds) {
    const key = String(userId);
    if (seen.has(key)) continue;
    seen.add(key);

    for (const socketId of onlineUsers.get(key) ?? []) {
      if (socketId === exceptSocketId) continue;
      io.to(socketId).emit(event, payload);
      delivered++;
    }
  }

  return delivered;
};
