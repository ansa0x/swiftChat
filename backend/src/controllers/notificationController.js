import mongoose from "mongoose";

import Notification from "../models/Notification.js";
import { serializeNotification } from "../lib/notify.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const parsePositiveInt = (value, fallback, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return max ? Math.min(parsed, max) : parsed;
};

export const getNotifications = async (req, res) => {
  const page = parsePositiveInt(req.query.page, 1);
  const limit = parsePositiveInt(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const skip = (page - 1) * limit;

  try {
    const filter = { recipient: req.userId };
    if (req.query.unread === "true") filter.read = false;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ recipient: req.userId, read: false }),
    ]);

    return res.status(200).json({
      notifications: notifications.map(serializeNotification),
      page,
      limit,
      total,
      unreadCount,
      hasMore: skip + notifications.length < total,
    });
  } catch (error) {
    console.error("getNotifications failed:", error);
    return res.status(500).json({ message: "Could not load notifications." });
  }
};

export const markAsRead = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "Invalid notification id." });
  }

  try {
    // Scoped to the caller, so one user can't mark another's notifications.
    const notification = await Notification.findOneAndUpdate(
      { _id: id, recipient: req.userId },
      { read: true },
      { new: true }
    ).lean();

    if (!notification) {
      return res.status(404).json({ message: "Notification not found." });
    }

    return res.status(200).json({
      notification: serializeNotification(notification),
      unreadCount: await Notification.countDocuments({
        recipient: req.userId,
        read: false,
      }),
    });
  } catch (error) {
    console.error("markAsRead failed:", error);
    return res.status(500).json({ message: "Could not update notification." });
  }
};

export const markAllAsRead = async (req, res) => {
  try {
    const { modifiedCount } = await Notification.updateMany(
      { recipient: req.userId, read: false },
      { read: true }
    );

    return res.status(200).json({ updated: modifiedCount, unreadCount: 0 });
  } catch (error) {
    console.error("markAllAsRead failed:", error);
    return res.status(500).json({ message: "Could not update notifications." });
  }
};
