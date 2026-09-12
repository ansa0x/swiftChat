import mongoose from "mongoose";

import Group from "../models/Group.js";
import User from "../models/User.js";
import Message from "../models/Message.js";
import Notification from "../models/Notification.js";
import { notifyUsers } from "../lib/notify.js";
import { emitToUsers } from "../sockets/registry.js";

const MEMBER_FIELDS = "username email profilePhoto";

const isValidId = (id) => mongoose.isValidObjectId(id);

const includesId = (list, id) => list.some((entry) => String(entry) === String(id));

// Members and admins are returned with the public field set only — the
// password hash must never leave the server.
const populateGroup = (groupId) =>
  Group.findById(groupId)
    .populate("members", MEMBER_FIELDS)
    .populate("admins", MEMBER_FIELDS)
    .populate("createdBy", MEMBER_FIELDS);

// Deletes a group along with everything that points at it: its messages, and
// any notification whose payload references the group id. Without this, a
// disbanded group leaves notifications linking to something that no longer
// resolves. Every notification type stores the group id at data.groupId
// (new_message for group sends, added_to_group, promoted_to_admin,
// group_renamed), so one query covers them all.
const deleteGroupAndRelated = async (group) => {
  const groupId = String(group._id);

  const [messages, notifications] = await Promise.all([
    Message.deleteMany({ group: group._id }),
    Notification.deleteMany({ "data.groupId": groupId }),
  ]);

  await group.deleteOne();

  return {
    deletedMessages: messages.deletedCount,
    deletedNotifications: notifications.deletedCount,
  };
};

/**
 * Broadcasts a membership change to everyone who needs to know.
 *
 * `affectedUserId` is included explicitly because the person who was just
 * removed is no longer in group.members — looking up recipients from the
 * post-change member list alone would silently skip the one user whose access
 * actually changed.
 */
const emitMembershipChanged = (group, type, affectedUserId) => {
  const updatedMembers = group.members.map(String);
  const updatedAdmins = group.admins.map(String);

  const recipients = new Set(updatedMembers);
  if (affectedUserId) recipients.add(String(affectedUserId));

  emitToUsers([...recipients], "group_membership_changed", {
    groupId: String(group._id),
    type,
    groupName: group.name,
    updatedMembers,
    updatedAdmins,
    affectedUserId: affectedUserId ? String(affectedUserId) : null,
  });
};

// Loads the group and enforces that the caller is an admin.
// Returns { group } on success or { status, message } to send back.
const loadGroupAsAdmin = async (groupId, callerId) => {
  if (!isValidId(groupId)) {
    return { status: 400, message: "Invalid group id." };
  }

  const group = await Group.findById(groupId);
  if (!group) return { status: 404, message: "Group not found." };

  if (!includesId(group.admins, callerId)) {
    return { status: 403, message: "Only a group admin can perform this action." };
  }

  return { group };
};

export const createGroup = async (req, res) => {
  const { name, memberIds = [] } = req.body ?? {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: "Group name is required." });
  }

  if (!Array.isArray(memberIds)) {
    return res.status(400).json({ message: "memberIds must be an array." });
  }

  const invalid = memberIds.filter((id) => !isValidId(id));
  if (invalid.length > 0) {
    return res.status(400).json({ message: `Invalid member id: ${invalid[0]}` });
  }

  try {
    // The creator is always a member and an admin, deduped against memberIds.
    const uniqueMemberIds = [
      ...new Set([String(req.userId), ...memberIds.map(String)]),
    ];

    const found = await User.countDocuments({ _id: { $in: uniqueMemberIds } });
    if (found !== uniqueMemberIds.length) {
      return res.status(400).json({ message: "One or more member ids do not exist." });
    }

    const group = await Group.create({
      name: String(name).trim(),
      members: uniqueMemberIds,
      admins: [req.userId],
      createdBy: req.userId,
    });

    return res.status(201).json({ group: await populateGroup(group._id) });
  } catch (error) {
    console.error("createGroup failed:", error);
    return res.status(500).json({ message: "Could not create group." });
  }
};

export const addMember = async (req, res) => {
  const { groupId } = req.params;
  const { userId } = req.body ?? {};

  if (!isValidId(userId)) {
    return res.status(400).json({ message: "A valid userId is required." });
  }

  try {
    const { group, status, message } = await loadGroupAsAdmin(groupId, req.userId);
    if (!group) return res.status(status).json({ message });

    if (includesId(group.members, userId)) {
      return res.status(409).json({ message: "User is already a member." });
    }

    const exists = await User.exists({ _id: userId });
    if (!exists) return res.status(404).json({ message: "User not found." });

    group.members.push(userId);
    await group.save();

    await notifyUsers([userId], "added_to_group", {
      groupId: String(group._id),
      groupName: group.name,
      addedBy: String(req.userId),
    });

    emitMembershipChanged(group, "member_added", userId);

    return res.status(200).json({ group: await populateGroup(group._id) });
  } catch (error) {
    console.error("addMember failed:", error);
    return res.status(500).json({ message: "Could not add member." });
  }
};

export const removeMember = async (req, res) => {
  const { groupId, userId } = req.params;

  if (!isValidId(userId)) {
    return res.status(400).json({ message: "Invalid user id." });
  }

  try {
    const { group, status, message } = await loadGroupAsAdmin(groupId, req.userId);
    if (!group) return res.status(status).json({ message });

    if (!includesId(group.members, userId)) {
      return res.status(404).json({ message: "User is not a member of this group." });
    }

    // Removing the only admin would leave the group with no one able to
    // manage it, so block it whether the caller is removing self or another.
    if (includesId(group.admins, userId) && group.admins.length === 1) {
      return res.status(400).json({
        message:
          "Cannot remove the last admin. Promote another member to admin first.",
      });
    }

    group.members = group.members.filter((m) => String(m) !== String(userId));
    group.admins = group.admins.filter((a) => String(a) !== String(userId));
    await group.save();

    emitMembershipChanged(group, "member_removed", userId);

    return res.status(200).json({ group: await populateGroup(group._id) });
  } catch (error) {
    console.error("removeMember failed:", error);
    return res.status(500).json({ message: "Could not remove member." });
  }
};

export const promoteToAdmin = async (req, res) => {
  const { groupId, userId } = req.params;

  if (!isValidId(userId)) {
    return res.status(400).json({ message: "Invalid user id." });
  }

  try {
    const { group, status, message } = await loadGroupAsAdmin(groupId, req.userId);
    if (!group) return res.status(status).json({ message });

    if (!includesId(group.members, userId)) {
      return res
        .status(400)
        .json({ message: "User must be a member before being promoted." });
    }

    if (includesId(group.admins, userId)) {
      return res.status(409).json({ message: "User is already an admin." });
    }

    group.admins.push(userId);
    await group.save();

    await notifyUsers([userId], "promoted_to_admin", {
      groupId: String(group._id),
      groupName: group.name,
      promotedBy: String(req.userId),
    });

    emitMembershipChanged(group, "promoted", userId);

    return res.status(200).json({ group: await populateGroup(group._id) });
  } catch (error) {
    console.error("promoteToAdmin failed:", error);
    return res.status(500).json({ message: "Could not promote user." });
  }
};

export const demoteAdmin = async (req, res) => {
  const { groupId, userId } = req.params;

  if (!isValidId(userId)) {
    return res.status(400).json({ message: "Invalid user id." });
  }

  try {
    const { group, status, message } = await loadGroupAsAdmin(groupId, req.userId);
    if (!group) return res.status(status).json({ message });

    if (!includesId(group.admins, userId)) {
      return res.status(400).json({ message: "User is not an admin." });
    }

    if (group.admins.length === 1) {
      return res.status(400).json({
        message: "Cannot demote the last admin. Promote another member first.",
      });
    }

    // Demotion drops admin rights only — the user stays in the group.
    group.admins = group.admins.filter((a) => String(a) !== String(userId));
    await group.save();

    emitMembershipChanged(group, "demoted", userId);

    return res.status(200).json({ group: await populateGroup(group._id) });
  } catch (error) {
    console.error("demoteAdmin failed:", error);
    return res.status(500).json({ message: "Could not demote admin." });
  }
};

export const renameGroup = async (req, res) => {
  const { groupId } = req.params;
  const { name } = req.body ?? {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: "Group name is required." });
  }

  try {
    const { group, status, message } = await loadGroupAsAdmin(groupId, req.userId);
    if (!group) return res.status(status).json({ message });

    const previousName = group.name;
    group.name = String(name).trim();
    await group.save();

    // Pushes the new name to every member's open client. The notification
    // below tells them it happened; this keeps their sidebar and thread header
    // from showing the old name until a refresh.
    emitMembershipChanged(group, "renamed", null);

    // Everyone in the group except the admin who performed the rename.
    const others = group.members.filter((m) => String(m) !== String(req.userId));
    await notifyUsers(others, "group_renamed", {
      groupId: String(group._id),
      groupName: group.name,
      previousName,
      renamedBy: String(req.userId),
    });

    return res.status(200).json({ group: await populateGroup(group._id) });
  } catch (error) {
    console.error("renameGroup failed:", error);
    return res.status(500).json({ message: "Could not rename group." });
  }
};

export const leaveGroup = async (req, res) => {
  const { groupId } = req.params;

  if (!isValidId(groupId)) {
    return res.status(400).json({ message: "Invalid group id." });
  }

  try {
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: "Group not found." });

    if (!includesId(group.members, req.userId)) {
      return res.status(404).json({ message: "You are not a member of this group." });
    }

    // Last member out disbands the group rather than leaving an empty shell
    // behind. Checked before the admin guard, which would otherwise trap them.
    if (group.members.length === 1) {
      const removed = await deleteGroupAndRelated(group);

      return res.status(200).json({
        deleted: true,
        groupId: String(group._id),
        ...removed,
        message: "You were the last member, so the group was deleted.",
      });
    }

    // Same guard as removeMember: the group must keep at least one admin.
    if (includesId(group.admins, req.userId) && group.admins.length === 1) {
      return res.status(400).json({
        message:
          "You are the last admin. Promote another member to admin before leaving.",
      });
    }

    group.members = group.members.filter((m) => String(m) !== String(req.userId));
    group.admins = group.admins.filter((a) => String(a) !== String(req.userId));
    await group.save();

    emitMembershipChanged(group, "member_left", req.userId);

    return res.status(200).json({ deleted: false, group: await populateGroup(group._id) });
  } catch (error) {
    console.error("leaveGroup failed:", error);
    return res.status(500).json({ message: "Could not leave group." });
  }
};

export const disbandGroup = async (req, res) => {
  const { groupId } = req.params;

  try {
    const { group, status, message } = await loadGroupAsAdmin(groupId, req.userId);
    if (!group) return res.status(status).json({ message });

    // Captured before deletion — the member list is gone afterwards.
    const memberIds = group.members.map(String);
    const groupName = group.name;

    const removed = await deleteGroupAndRelated(group);

    // Tell every member (including the admin's other sessions) so an open
    // thread can close itself instead of silently breaking.
    emitToUsers(memberIds, "group_disbanded", {
      groupId: String(group._id),
      groupName,
      disbandedBy: String(req.userId),
    });

    return res.status(200).json({
      deleted: true,
      groupId: String(group._id),
      ...removed,
    });
  } catch (error) {
    console.error("disbandGroup failed:", error);
    return res.status(500).json({ message: "Could not disband group." });
  }
};

export const getGroupDetails = async (req, res) => {
  const { groupId } = req.params;

  if (!isValidId(groupId)) {
    return res.status(400).json({ message: "Invalid group id." });
  }

  try {
    const group = await populateGroup(groupId);
    if (!group) return res.status(404).json({ message: "Group not found." });

    // Membership is private — only members may read a group's roster.
    const isMember = group.members.some(
      (member) => String(member._id) === String(req.userId)
    );
    if (!isMember) {
      return res
        .status(403)
        .json({ message: "Only group members can view this group." });
    }

    return res.status(200).json({ group });
  } catch (error) {
    console.error("getGroupDetails failed:", error);
    return res.status(500).json({ message: "Could not load group." });
  }
};
