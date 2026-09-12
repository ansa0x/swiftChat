import mongoose from "mongoose";

import Message from "../models/Message.js";
import Group from "../models/Group.js";

// Latest message + unread count per 1:1 partner.
const directConversations = async (meId) =>
  Message.aggregate([
    // 1:1 only — `group: null` also matches documents with no group field.
    { $match: { group: null, $or: [{ sender: meId }, { recipient: meId }] } },
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $addFields: {
        peer: { $cond: [{ $eq: ["$sender", meId] }, "$recipient", "$sender"] },
      },
    },
    {
      $group: {
        _id: "$peer",
        lastMessage: { $first: "$$ROOT" },
        unreadCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$recipient", meId] },
                  { $not: [{ $in: [meId, { $ifNull: ["$readBy", []] }] }] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
    { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "peer" } },
    { $unwind: "$peer" },
    {
      $project: {
        _id: 0,
        type: "direct",
        user: {
          id: { $toString: "$peer._id" },
          username: "$peer.username",
          profilePhoto: "$peer.profilePhoto",
        },
        lastMessage: {
          id: { $toString: "$lastMessage._id" },
          content: "$lastMessage.content",
          createdAt: "$lastMessage.createdAt",
          sender: { $toString: "$lastMessage.sender" },
        },
        unreadCount: 1,
      },
    },
  ]);

// Latest message + unread count per group, keyed by group id.
const groupActivity = async (meId, groupIds) => {
  if (groupIds.length === 0) return new Map();

  const rows = await Message.aggregate([
    { $match: { group: { $in: groupIds } } },
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $group: {
        _id: "$group",
        lastMessage: { $first: "$$ROOT" },
        unreadCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  // Your own messages are never unread for you.
                  { $ne: ["$sender", meId] },
                  { $not: [{ $in: [meId, { $ifNull: ["$readBy", []] }] }] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
    {
      $project: {
        _id: 1,
        unreadCount: 1,
        lastMessage: {
          id: { $toString: "$lastMessage._id" },
          content: "$lastMessage.content",
          createdAt: "$lastMessage.createdAt",
          sender: { $toString: "$lastMessage.sender" },
        },
      },
    },
  ]);

  return new Map(rows.map((row) => [String(row._id), row]));
};

/**
 * One merged, recency-sorted list of 1:1 threads and groups the caller belongs
 * to. Groups with no messages yet still appear, ordered by when they were
 * created, so a freshly made group doesn't vanish from the sidebar.
 */
export const getConversations = async (req, res) => {
  try {
    const meId = new mongoose.Types.ObjectId(String(req.userId));

    const myGroups = await Group.find({ members: meId })
      .select("name members admins createdAt")
      .lean();

    const [direct, activity] = await Promise.all([
      directConversations(meId),
      groupActivity(
        meId,
        myGroups.map((group) => group._id)
      ),
    ]);

    const groups = myGroups.map((group) => {
      const row = activity.get(String(group._id));

      return {
        type: "group",
        group: {
          id: String(group._id),
          name: group.name,
          memberCount: group.members.length,
          isAdmin: group.admins.some((a) => String(a) === String(req.userId)),
        },
        lastMessage: row?.lastMessage ?? null,
        unreadCount: row?.unreadCount ?? 0,
        // Fallback sort key for a group nobody has posted in yet.
        createdAt: group.createdAt,
      };
    });

    const sortKey = (entry) =>
      new Date(entry.lastMessage?.createdAt ?? entry.createdAt ?? 0).getTime();

    const conversations = [...direct, ...groups].sort(
      (a, b) => sortKey(b) - sortKey(a)
    );

    return res.status(200).json({ conversations });
  } catch (error) {
    console.error("getConversations failed:", error);
    return res.status(500).json({ message: "Could not load conversations." });
  }
};
