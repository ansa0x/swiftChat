import User from "../models/User.js";

const PUBLIC_FIELDS = "username email profilePhoto createdAt";

// Everyone except the caller — the list of people they can start a chat with.
export const getUsers = async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.userId } })
      .select(PUBLIC_FIELDS)
      .sort({ username: 1 })
      .lean();

    return res.status(200).json({
      users: users.map((user) => ({
        id: String(user._id),
        username: user.username,
        email: user.email,
        profilePhoto: user.profilePhoto,
      })),
    });
  } catch (error) {
    console.error("getUsers failed:", error);
    return res.status(500).json({ message: "Could not load users." });
  }
};
