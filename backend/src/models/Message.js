import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  group: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Group",
  },
  content: {
    type: String,
    required: true,
  },
  readBy: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// A message is either 1:1 (recipient) or group (group) — never both, never neither.
messageSchema.pre("validate", function (next) {
  const hasRecipient = Boolean(this.recipient);
  const hasGroup = Boolean(this.group);

  if (hasRecipient === hasGroup) {
    this.invalidate(
      "recipient",
      "A message must set exactly one of recipient or group, not both or neither."
    );
  }

  next();
});

const Message = mongoose.model("Message", messageSchema);

export default Message;
