import jwt from "jsonwebtoken";

import User from "../models/User.js";

const TOKEN_EXPIRY = "7d";
export const MIN_PASSWORD_LENGTH = 8;

const signToken = (userId) => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is not defined. Check your .env file.");
  }

  return jwt.sign({ id: userId }, secret, { expiresIn: TOKEN_EXPIRY });
};

// Shape a user document for the client — never includes the password hash.
const publicUser = (user) => ({
  id: user._id,
  username: user.username,
  email: user.email,
  profilePhoto: user.profilePhoto,
  createdAt: user.createdAt,
});

export const register = async (req, res) => {
  const { username, email, password } = req.body ?? {};

  if (!username || !email || !password) {
    return res
      .status(400)
      .json({ message: "username, email, and password are required." });
  }

  // Checked here rather than only on the schema, so the client gets a specific
  // message and field instead of a raw Mongoose validation string.
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      field: "password",
    });
  }

  try {
    // The pre-save hook on the User schema hashes the password.
    const user = await User.create({ username, email, password });

    return res
      .status(201)
      .json({ token: signToken(user._id), user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern ?? {})[0] ?? "field";
      // `field` lets the client highlight the offending input directly.
      return res
        .status(409)
        .json({ message: `That ${field} is already taken.`, field });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }

    console.error("register failed:", error);
    return res.status(500).json({ message: "Could not register user." });
  }
};

export const login = async (req, res) => {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ message: "email and password are required." });
  }

  try {
    // Emails are stored lowercased by the schema, so normalize before lookup.
    const user = await User.findOne({ email: String(email).trim().toLowerCase() });

    // Same response whether the user is missing or the password is wrong,
    // so the endpoint doesn't leak which emails are registered.
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    return res
      .status(200)
      .json({ token: signToken(user._id), user: publicUser(user) });
  } catch (error) {
    console.error("login failed:", error);
    return res.status(500).json({ message: "Could not log in." });
  }
};
