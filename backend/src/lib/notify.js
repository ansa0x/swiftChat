import Notification from "../models/Notification.js";
import { emitToUsers } from "../sockets/registry.js";

export const serializeNotification = (notification) => ({
  id: String(notification._id),
  recipient: String(notification.recipient),
  type: notification.type,
  data: notification.data ?? {},
  read: notification.read,
  createdAt: notification.createdAt,
});

/**
 * Persists one notification per recipient and pushes it to whichever of their
 * sockets are connected. Recipients are deduped, and the acting user should be
 * excluded by the caller.
 *
 * Notification failures are logged rather than thrown: a missing notification
 * should never break the message send or group change that triggered it.
 */
export const notifyUsers = async (recipientIds, type, data = {}) => {
  const unique = [...new Set((recipientIds ?? []).map(String))].filter(Boolean);
  if (unique.length === 0) return [];

  try {
    const created = await Notification.insertMany(
      unique.map((recipient) => ({ recipient, type, data }))
    );

    for (const notification of created) {
      emitToUsers(
        [notification.recipient],
        "new_notification",
        serializeNotification(notification)
      );
    }

    return created;
  } catch (error) {
    console.error(`notifyUsers(${type}) failed:`, error);
    return [];
  }
};

export default notifyUsers;
