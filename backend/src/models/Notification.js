import mongoose from "mongoose";

export const NOTIFICATION_TYPES = [
  "new_message",
  "added_to_group",
  "promoted_to_admin",
  "group_renamed",
];

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  type: {
    type: String,
    enum: NOTIFICATION_TYPES,
    required: true,
  },
  // Free-form payload — sender id, group id, message preview, and so on.
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  read: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Backs the main query: one user's notifications, newest first.
notificationSchema.index({ recipient: 1, createdAt: -1 });

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
