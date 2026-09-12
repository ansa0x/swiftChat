import express from "express";

import {
  getConversation,
  getGroupConversation,
} from "../controllers/messageController.js";
import { protectRoute } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protectRoute);

// Declared before "/:userId" so "group" is never read as a user id.
router.get("/group/:groupId", getGroupConversation);
router.get("/:userId", getConversation);

export default router;
