import mongoose from "mongoose";

import Message from "../models/Message.js";
import User from "../models/User.js";
import Group from "../models/Group.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const serializeMessage = (message) => ({
  id: String(message._id),
  sender: String(message.sender),
  recipient: message.recipient ? String(message.recipient) : null,
  group: message.group ? String(message.group) : null,
  content: message.content,
  readBy: (message.readBy ?? []).map(String),
  createdAt: message.createdAt,
});

// The message history for a group the caller belongs to, oldest first.
export const getGroupConversation = async (req, res) => {
  const { groupId } = req.params;

  if (!mongoose.isValidObjectId(groupId)) {
    return res.status(400).json({ message: "Invalid group id." });
  }

  const parsedLimit = Number.parseInt(req.query.limit, 10);
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

  try {
    const group = await Group.findById(groupId).select("members").lean();
    if (!group) return res.status(404).json({ message: "Group not found." });

    const isMember = group.members.some((m) => String(m) === String(req.userId));
    if (!isMember) {
      return res
        .status(403)
        .json({ message: "Only group members can read this thread." });
    }

    const messages = await Message.find({ group: groupId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();

    return res.status(200).json({
      messages: messages.reverse().map(serializeMessage),
    });
  } catch (error) {
    console.error("getGroupConversation failed:", error);
    return res.status(500).json({ message: "Could not load messages." });
  }
};

// The 1:1 thread between the caller and :userId, oldest first so the client
// can render straight down the page.
export const getConversation = async (req, res) => {
  const { userId } = req.params;

  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ message: "Invalid user id." });
  }

  const parsedLimit = Number.parseInt(req.query.limit, 10);
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

  try {
    const other = await User.exists({ _id: userId });
    if (!other) return res.status(404).json({ message: "User not found." });

    // Sorted newest-first for the limit, then reversed so the newest `limit`
    // messages come back in chronological order.
    const messages = await Message.find({
      group: null,
      $or: [
        { sender: req.userId, recipient: userId },
        { sender: userId, recipient: req.userId },
      ],
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();

    return res.status(200).json({
      messages: messages.reverse().map(serializeMessage),
    });
  } catch (error) {
    console.error("getConversation failed:", error);
    return res.status(500).json({ message: "Could not load messages." });
  }
};
