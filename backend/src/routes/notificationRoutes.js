import express from "express";

import {
  getNotifications,
  markAsRead,
  markAllAsRead,
} from "../controllers/notificationController.js";
import { protectRoute } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protectRoute);

router.get("/", getNotifications);
// Declared before "/:id/read" so "read-all" is never read as an id.
router.patch("/read-all", markAllAsRead);
router.patch("/:id/read", markAsRead);

export default router;
