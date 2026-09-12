import express from "express";
import rateLimit from "express-rate-limit";

import { register, login } from "../controllers/authController.js";

const router = express.Router();

const MINUTE = 60 * 1000;

// Rejects with a JSON body rather than express-rate-limit's plain-text default,
// so clients get the same error shape as every other auth response.
const limitExceeded = (message) => (req, res) => res.status(429).json({ message });

const loginLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: limitExceeded(
    "Too many login attempts. Please try again in 15 minutes."
  ),
});

const registerLimiter = rateLimit({
  windowMs: 60 * MINUTE,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: limitExceeded(
    "Too many accounts created from this IP. Please try again in an hour."
  ),
});

router.post("/register", registerLimiter, register);
router.post("/login", loginLimiter, login);

export default router;
