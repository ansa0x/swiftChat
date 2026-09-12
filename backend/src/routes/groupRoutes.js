import express from "express";

import {
  createGroup,
  addMember,
  removeMember,
  promoteToAdmin,
  demoteAdmin,
  renameGroup,
  getGroupDetails,
  leaveGroup,
  disbandGroup,
} from "../controllers/groupController.js";
import { protectRoute } from "../middleware/authMiddleware.js";

const router = express.Router();

// Every group route requires a valid JWT.
router.use(protectRoute);

router.post("/", createGroup);
router.get("/:groupId", getGroupDetails);
router.delete("/:groupId", disbandGroup);
router.post("/:groupId/leave", leaveGroup);
router.patch("/:groupId/name", renameGroup);
router.post("/:groupId/members", addMember);
router.delete("/:groupId/members/:userId", removeMember);
router.patch("/:groupId/admins/:userId/promote", promoteToAdmin);
router.patch("/:groupId/admins/:userId/demote", demoteAdmin);

export default router;
