import express from "express";

import { getConversations } from "../controllers/conversationController.js";
import { protectRoute } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protectRoute);

router.get("/", getConversations);

export default router;
