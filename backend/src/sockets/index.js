import mongoose from "mongoose";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";

import Message from "../models/Message.js";
import Group from "../models/Group.js";
import User from "../models/User.js";
import { allowedOrigins } from "../lib/allowedOrigins.js";
import { notifyUsers } from "../lib/notify.js";
import {
  setIo,
  addSocket,
  removeSocket,
  getOnlineUsers,
  isUserOnline,
  emitToUsers,
} from "./registry.js";

export { getOnlineUsers, isUserOnline };

const MESSAGE_PREVIEW_LENGTH = 120;

// Serialized shape sent to clients — ids as strings so they compare cleanly.
const serializeMessage = (message) => ({
  id: String(message._id),
  sender: String(message.sender),
  recipient: message.recipient ? String(message.recipient) : null,
  group: message.group ? String(message.group) : null,
  content: message.content,
  readBy: (message.readBy ?? []).map(String),
  createdAt: message.createdAt,
});

// Resolves who should receive traffic for a conversation, and rejects
// anything the sender isn't entitled to post to.
const resolveAudience = async (senderId, { recipientId, groupId }) => {
  const hasRecipient = Boolean(recipientId);
  const hasGroup = Boolean(groupId);

  if (hasRecipient === hasGroup) {
    return { error: "Provide exactly one of recipientId or groupId." };
  }

  if (hasRecipient) {
    return { userIds: [senderId, String(recipientId)] };
  }

  const group = await Group.findById(groupId).select("members name").lean();
  if (!group) return { error: "Group not found." };

  const isMember = group.members.some((m) => String(m) === String(senderId));
  if (!isMember) return { error: "You are not a member of this group." };

  return { userIds: group.members.map(String), group };
};

const authenticateSocket = async (socket, next) => {
  const token = socket.handshake.auth?.token;

  if (!token) {
    return next(new Error("Authentication required."));
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return next(new Error("Invalid or expired token."));
  }

  try {
    // Resolved once per connection so notifications can name the sender
    // without a lookup on every message. Also rejects tokens whose account
    // has since been deleted.
    const user = await User.findById(decoded.id).select("username").lean();
    if (!user) return next(new Error("Account no longer exists."));

    socket.userId = String(decoded.id);
    socket.username = user.username;
    next();
  } catch (error) {
    console.error("socket auth lookup failed:", error);
    next(new Error("Could not authenticate."));
  }
};

export const initSocketServer = (httpServer) => {
  const io = new Server(httpServer, {
    cors: { origin: allowedOrigins, credentials: true },
  });

  setIo(io);
  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    const { userId } = socket;
    const sessionCount = addSocket(userId, socket.id);

    // Only announce presence when this is the user's first live session.
    if (sessionCount === 1) {
      socket.broadcast.emit("user_online", { userId });
    }

    socket.emit("online_users", { users: getOnlineUsers() });

    socket.on("send_message", async (payload = {}, ack) => {
      const { recipientId, groupId, content } = payload;

      const respond = (result) => {
        if (typeof ack === "function") ack(result);
        if (result.error) socket.emit("message_error", { message: result.error });
      };

      if (!content || !String(content).trim()) {
        return respond({ ok: false, error: "Message content is required." });
      }

      try {
        const audience = await resolveAudience(userId, { recipientId, groupId });
        if (audience.error) return respond({ ok: false, error: audience.error });

        const message = await Message.create({
          sender: userId,
          recipient: recipientId ?? undefined,
          group: groupId ?? undefined,
          content: String(content).trim(),
        });

        const serialized = serializeMessage(message);

        // Everyone in the audience, plus the sender's *other* sessions —
        // but not the socket that sent it, which gets the ack instead.
        emitToUsers(audience.userIds, "receive_message", serialized, socket.id);

        // Notify everyone in the conversation except the sender.
        const notifyIds = audience.userIds.filter((id) => String(id) !== String(userId));
        await notifyUsers(notifyIds, "new_message", {
          messageId: serialized.id,
          senderId: userId,
          senderUsername: socket.username ?? null,
          groupId: serialized.group,
          groupName: audience.group?.name ?? null,
          preview: serialized.content.slice(0, MESSAGE_PREVIEW_LENGTH),
        });

        respond({ ok: true, message: serialized });
      } catch (error) {
        console.error("send_message failed:", error);
        respond({ ok: false, error: "Could not send message." });
      }
    });

    const relayTyping = (event) => async (payload = {}) => {
      const { recipientId, groupId } = payload;

      try {
        const audience = await resolveAudience(userId, { recipientId, groupId });
        if (audience.error) return;

        emitToUsers(
          audience.userIds,
          event,
          {
            userId,
            groupId: groupId ? String(groupId) : null,
          },
          socket.id
        );
      } catch (error) {
        console.error(`${event} failed:`, error);
      }
    };

    // Marks every unread message from `senderId` to this user as read. The
    // $ne guard keeps the write to genuinely-unread rows, so modifiedCount is
    // a real count rather than a no-op rewrite of the whole thread.
    socket.on("mark_read", async (payload = {}, ack) => {
      const { senderId, groupId } = payload;

      const respond = (result) => {
        if (typeof ack === "function") ack(result);
      };

      const target = groupId ?? senderId;
      if (!target || !mongoose.isValidObjectId(target)) {
        return respond({
          ok: false,
          error: "A valid senderId or groupId is required.",
        });
      }

      try {
        const meObjectId = new mongoose.Types.ObjectId(String(userId));

        if (groupId) {
          const group = await Group.findById(groupId).select("members").lean();
          if (!group) return respond({ ok: false, error: "Group not found." });

          const isMember = group.members.some(
            (m) => String(m) === String(userId)
          );
          if (!isMember) {
            return respond({ ok: false, error: "You are not a member of this group." });
          }

          const { modifiedCount } = await Message.updateMany(
            {
              group: groupId,
              sender: { $ne: userId },
              readBy: { $ne: meObjectId },
            },
            { $addToSet: { readBy: userId } }
          );

          if (modifiedCount > 0) {
            const others = group.members
              .map(String)
              .filter((id) => id !== String(userId));
            emitToUsers(others, "messages_read", {
              readBy: userId,
              groupId: String(groupId),
            });
          }

          return respond({ ok: true, updated: modifiedCount });
        }

        const { modifiedCount } = await Message.updateMany(
          {
            group: null,
            sender: senderId,
            recipient: userId,
            readBy: { $ne: meObjectId },
          },
          { $addToSet: { readBy: userId } }
        );

        // Tell the original sender their messages were seen.
        if (modifiedCount > 0) {
          emitToUsers([senderId], "messages_read", {
            readBy: userId,
            senderId: String(senderId),
          });
        }

        return respond({ ok: true, updated: modifiedCount });
      } catch (error) {
        console.error("mark_read failed:", error);
        return respond({ ok: false, error: "Could not mark messages as read." });
      }
    });

    socket.on("typing_start", relayTyping("user_typing"));
    socket.on("typing_stop", relayTyping("user_stopped_typing"));

    socket.on("disconnect", () => {
      const remaining = removeSocket(userId, socket.id);

      if (remaining === 0) {
        socket.broadcast.emit("user_offline", { userId });
      }
    });
  });

  return io;
};

export default initSocketServer;
