import mongoose from "mongoose";
import dotenv from "dotenv";

import User from "../src/models/User.js";
import Group from "../src/models/Group.js";
import Message from "../src/models/Message.js";
import Notification from "../src/models/Notification.js";

dotenv.config();

const API = "http://localhost:5000";
const SUFFIX = process.argv[2] ?? "1";
const emailFor = (who) => `grouptest_${who}_${SUFFIX}@example.com`;
const EMAILS = ["a", "b", "c"].map(emailFor);

let pass = 0;
let fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
};

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
};

const registerUser = async (who) => {
  const r = await api("POST", "/api/auth/register", {
    body: {
      username: `grouptest_${who}_${SUFFIX}`,
      email: emailFor(who),
      password: "grouppassword123",
    },
  });
  if (r.status !== 201) {
    throw new Error(`register ${who} -> ${r.status} ${JSON.stringify(r.body)}`);
  }
  return r.body;
};

await mongoose.connect(process.env.MONGO_URI);

const cleanup = async () => {
  const users = await User.find({ email: { $in: EMAILS } }, "_id").lean();
  const ids = users.map((u) => u._id);
  const groups = await Group.find(
    { $or: [{ createdBy: { $in: ids } }, { members: { $in: ids } }] },
    "_id"
  ).lean();
  const groupIds = groups.map((g) => g._id);

  const n = await Notification.deleteMany({ recipient: { $in: ids } });
  const m = await Message.deleteMany({
    $or: [{ sender: { $in: ids } }, { recipient: { $in: ids } }, { group: { $in: groupIds } }],
  });
  const g = await Group.deleteMany({ _id: { $in: groupIds } });
  const u = await User.deleteMany({ _id: { $in: ids } });
  return {
    notifications: n.deletedCount,
    messages: m.deletedCount,
    groups: g.deletedCount,
    users: u.deletedCount,
  };
};

await cleanup(); // clear anything left by a prior run

const A = await registerUser("a"); // creator + admin
const B = await registerUser("b"); // plain member
const C = await registerUser("c"); // outsider, later added
const idA = A.user.id;
const idB = B.user.id;
const idC = C.user.id;

const ids = (list) => (list ?? []).map((entry) => String(entry._id ?? entry));

console.log("Auth guard");
const noToken = await api("GET", `/api/groups/${new mongoose.Types.ObjectId()}`);
check("no token -> 401", noToken.status === 401, JSON.stringify(noToken));
const badToken = await api("GET", `/api/groups/${new mongoose.Types.ObjectId()}`, {
  token: "garbage",
});
check("bad token -> 401", badToken.status === 401);

console.log("\ncreateGroup");
const noName = await api("POST", "/api/groups", { token: A.token, body: { memberIds: [] } });
check("missing name -> 400", noName.status === 400, JSON.stringify(noName));

const badMember = await api("POST", "/api/groups", {
  token: A.token,
  body: { name: "Bad", memberIds: ["not-an-id"] },
});
check("invalid memberId -> 400", badMember.status === 400, JSON.stringify(badMember));

const ghostMember = await api("POST", "/api/groups", {
  token: A.token,
  body: { name: "Ghost", memberIds: [String(new mongoose.Types.ObjectId())] },
});
check("nonexistent memberId -> 400", ghostMember.status === 400, JSON.stringify(ghostMember));

const created = await api("POST", "/api/groups", {
  token: A.token,
  body: { name: "Study Group", memberIds: [idB] },
});
check("createGroup -> 201", created.status === 201, JSON.stringify(created));
const groupId = created.body?.group?._id;
check("creator is a member", ids(created.body?.group?.members).includes(idA));
check("invited user is a member", ids(created.body?.group?.members).includes(idB));
check("creator is an admin", ids(created.body?.group?.admins).includes(idA));
check("invited user is NOT an admin", !ids(created.body?.group?.admins).includes(idB));
check("createdBy is the creator", String(created.body?.group?.createdBy?._id) === idA);

const dupCreator = await api("POST", "/api/groups", {
  token: A.token,
  body: { name: "Dedupe", memberIds: [idA, idA, idB] },
});
check(
  "creator not duplicated in members",
  ids(dupCreator.body?.group?.members).filter((m) => m === idA).length === 1,
  JSON.stringify(ids(dupCreator.body?.group?.members))
);

console.log("\ngetGroupDetails");
const details = await api("GET", `/api/groups/${groupId}`, { token: A.token });
check("member can read details -> 200", details.status === 200, JSON.stringify(details));
check("members are populated", Boolean(details.body?.group?.members?.[0]?.username));
check(
  "populated members expose profilePhoto",
  details.body?.group?.members?.[0]?.profilePhoto !== undefined
);
const serialized = JSON.stringify(details.body);
check("password never appears in response", !serialized.includes("password"));
check("password hash never appears in response", !serialized.includes("$2b$"));

const outsiderRead = await api("GET", `/api/groups/${groupId}`, { token: C.token });
check("non-member read -> 403", outsiderRead.status === 403, JSON.stringify(outsiderRead));

const badIdRead = await api("GET", "/api/groups/not-an-id", { token: A.token });
check("malformed group id -> 400", badIdRead.status === 400, JSON.stringify(badIdRead));

const missingRead = await api("GET", `/api/groups/${new mongoose.Types.ObjectId()}`, {
  token: A.token,
});
check("unknown group id -> 404", missingRead.status === 404, JSON.stringify(missingRead));

console.log("\naddMember");
const nonAdminAdd = await api("POST", `/api/groups/${groupId}/members`, {
  token: B.token,
  body: { userId: idC },
});
check("non-admin add -> 403", nonAdminAdd.status === 403, JSON.stringify(nonAdminAdd));

const added = await api("POST", `/api/groups/${groupId}/members`, {
  token: A.token,
  body: { userId: idC },
});
check("admin add -> 200", added.status === 200, JSON.stringify(added));
check("member count is 3", ids(added.body?.group?.members).length === 3);

const addAgain = await api("POST", `/api/groups/${groupId}/members`, {
  token: A.token,
  body: { userId: idC },
});
check("adding existing member -> 409", addAgain.status === 409, JSON.stringify(addAgain));

const addGhost = await api("POST", `/api/groups/${groupId}/members`, {
  token: A.token,
  body: { userId: String(new mongoose.Types.ObjectId()) },
});
check("adding unknown user -> 404", addGhost.status === 404, JSON.stringify(addGhost));

console.log("\npromoteToAdmin");
const promoteOutsider = await api(
  "PATCH",
  `/api/groups/${groupId}/admins/${new mongoose.Types.ObjectId()}/promote`,
  { token: A.token }
);
check("promoting a non-member -> 400", promoteOutsider.status === 400, JSON.stringify(promoteOutsider));
console.log(`        -> ${promoteOutsider.body?.message}`);

const nonAdminPromote = await api("PATCH", `/api/groups/${groupId}/admins/${idC}/promote`, {
  token: B.token,
});
check("non-admin promote -> 403", nonAdminPromote.status === 403, JSON.stringify(nonAdminPromote));

const promoted = await api("PATCH", `/api/groups/${groupId}/admins/${idC}/promote`, {
  token: A.token,
});
check("admin promote -> 200", promoted.status === 200, JSON.stringify(promoted));
check("promoted user is now admin", ids(promoted.body?.group?.admins).includes(idC));
check("promoted user still a member", ids(promoted.body?.group?.members).includes(idC));

const promoteAgain = await api("PATCH", `/api/groups/${groupId}/admins/${idC}/promote`, {
  token: A.token,
});
check("promoting existing admin -> 409", promoteAgain.status === 409, JSON.stringify(promoteAgain));

console.log("\ndemoteAdmin");
const nonAdminDemote = await api("PATCH", `/api/groups/${groupId}/admins/${idA}/demote`, {
  token: B.token,
});
check("non-admin demote -> 403", nonAdminDemote.status === 403, JSON.stringify(nonAdminDemote));

const demoteNonAdmin = await api("PATCH", `/api/groups/${groupId}/admins/${idB}/demote`, {
  token: A.token,
});
check("demoting a non-admin -> 400", demoteNonAdmin.status === 400, JSON.stringify(demoteNonAdmin));

const demoted = await api("PATCH", `/api/groups/${groupId}/admins/${idC}/demote`, {
  token: A.token,
});
check("admin demote -> 200", demoted.status === 200, JSON.stringify(demoted));
check("demoted user removed from admins", !ids(demoted.body?.group?.admins).includes(idC));
check("demoted user KEPT as member", ids(demoted.body?.group?.members).includes(idC));

const lastAdminDemote = await api("PATCH", `/api/groups/${groupId}/admins/${idA}/demote`, {
  token: A.token,
});
check("demoting last admin -> 400", lastAdminDemote.status === 400, JSON.stringify(lastAdminDemote));
console.log(`        -> ${lastAdminDemote.body?.message}`);

console.log("\nremoveMember");
const nonAdminRemove = await api("DELETE", `/api/groups/${groupId}/members/${idC}`, {
  token: B.token,
});
check("non-admin remove -> 403", nonAdminRemove.status === 403, JSON.stringify(nonAdminRemove));

const removeLastAdmin = await api("DELETE", `/api/groups/${groupId}/members/${idA}`, {
  token: A.token,
});
check("removing self as last admin -> 400", removeLastAdmin.status === 400, JSON.stringify(removeLastAdmin));
console.log(`        -> ${removeLastAdmin.body?.message}`);

const removed = await api("DELETE", `/api/groups/${groupId}/members/${idC}`, {
  token: A.token,
});
check("admin remove -> 200", removed.status === 200, JSON.stringify(removed));
check("removed user gone from members", !ids(removed.body?.group?.members).includes(idC));

const removeNonMember = await api("DELETE", `/api/groups/${groupId}/members/${idC}`, {
  token: A.token,
});
check("removing a non-member -> 404", removeNonMember.status === 404, JSON.stringify(removeNonMember));

// Re-add C and promote, so removal of an admin who is NOT the last one works.
await api("POST", `/api/groups/${groupId}/members`, { token: A.token, body: { userId: idC } });
await api("PATCH", `/api/groups/${groupId}/admins/${idC}/promote`, { token: A.token });
const removeCoAdmin = await api("DELETE", `/api/groups/${groupId}/members/${idC}`, {
  token: A.token,
});
check("removing a non-last admin -> 200", removeCoAdmin.status === 200, JSON.stringify(removeCoAdmin));
check("that admin dropped from admins too", !ids(removeCoAdmin.body?.group?.admins).includes(idC));

console.log("\nrenameGroup");
const nonAdminRename = await api("PATCH", `/api/groups/${groupId}/name`, {
  token: B.token,
  body: { name: "Hijacked" },
});
check("non-admin rename -> 403", nonAdminRename.status === 403, JSON.stringify(nonAdminRename));

const emptyRename = await api("PATCH", `/api/groups/${groupId}/name`, {
  token: A.token,
  body: { name: "   " },
});
check("empty name -> 400", emptyRename.status === 400, JSON.stringify(emptyRename));

const renamed = await api("PATCH", `/api/groups/${groupId}/name`, {
  token: A.token,
  body: { name: "  Renamed Group  " },
});
check("admin rename -> 200", renamed.status === 200, JSON.stringify(renamed));
check("name updated and trimmed", renamed.body?.group?.name === "Renamed Group",
  JSON.stringify(renamed.body?.group?.name));

const persisted = await Group.findById(groupId).lean();
check("rename persisted in MongoDB", persisted?.name === "Renamed Group");

console.log("\nleaveGroup");
// Group currently stands at members [A, B], admins [A].
const leaveBadId = await api("POST", "/api/groups/not-an-id/leave", { token: A.token });
check("leave with malformed id -> 400", leaveBadId.status === 400, JSON.stringify(leaveBadId));

const leaveNonMember = await api("POST", `/api/groups/${groupId}/leave`, { token: C.token });
check("leaving a group you're not in -> 404", leaveNonMember.status === 404, JSON.stringify(leaveNonMember));

const lastAdminLeave = await api("POST", `/api/groups/${groupId}/leave`, { token: A.token });
check("last admin with members remaining cannot leave -> 400",
  lastAdminLeave.status === 400, JSON.stringify(lastAdminLeave));
console.log(`        -> ${lastAdminLeave.body?.message}`);

const plainMemberLeave = await api("POST", `/api/groups/${groupId}/leave`, { token: B.token });
check("non-admin member leaves freely -> 200", plainMemberLeave.status === 200, JSON.stringify(plainMemberLeave));
check("leave did not delete the group", plainMemberLeave.body?.deleted === false);
check("leaver removed from members", !ids(plainMemberLeave.body?.group?.members).includes(idB));

// A is now the sole remaining member; leaving should delete the group.
const strayMessages = await Message.insertMany([
  { sender: idA, group: groupId, content: "left behind 1" },
  { sender: idA, group: groupId, content: "left behind 2" },
]);
check("seeded messages in the group", strayMessages.length === 2);

// Earlier addMember / promote / rename calls generated notifications that
// reference this group; they should not outlive it.
const notifsBeforeLeave = await Notification.countDocuments({ "data.groupId": groupId });
check("group has notifications before the auto-delete", notifsBeforeLeave > 0,
  `count = ${notifsBeforeLeave}`);

const lastMemberLeave = await api("POST", `/api/groups/${groupId}/leave`, { token: A.token });
check("last member leaving -> 200", lastMemberLeave.status === 200, JSON.stringify(lastMemberLeave));
check("last member leaving deletes the group", lastMemberLeave.body?.deleted === true,
  JSON.stringify(lastMemberLeave.body));
check("group is gone from MongoDB", (await Group.countDocuments({ _id: groupId })) === 0);
check("its messages were removed too",
  (await Message.countDocuments({ group: groupId })) === 0);
check("its notifications were removed too",
  (await Notification.countDocuments({ "data.groupId": groupId })) === 0);
check("leave response reports deletedNotifications",
  lastMemberLeave.body?.deletedNotifications === notifsBeforeLeave,
  JSON.stringify(lastMemberLeave.body));

console.log("\ndisbandGroup");
const g2 = await api("POST", "/api/groups", {
  token: A.token,
  body: { name: "Disband Me", memberIds: [idB] },
});
const g2Id = g2.body?.group?._id;
check("second group created", g2.status === 201, JSON.stringify(g2));

const seeded = await Message.insertMany([
  { sender: idA, group: g2Id, content: "group msg 1" },
  { sender: idB, group: g2Id, content: "group msg 2" },
  { sender: idA, group: g2Id, content: "group msg 3" },
]);
check("seeded 3 group messages", seeded.length === 3);

// A 1:1 message that must survive the disband.
const dm = await Message.create({ sender: idA, recipient: idB, content: "unrelated dm" });

// Generate real notifications against g2 through the API, so they carry the
// same data.groupId shape production traffic would.
await api("POST", `/api/groups/${g2Id}/members`, { token: A.token, body: { userId: idC } });
await api("PATCH", `/api/groups/${g2Id}/name`, { token: A.token, body: { name: "Disband Me Renamed" } });
const g2Notifs = await Notification.countDocuments({ "data.groupId": g2Id });
check("g2 has notifications to clean up", g2Notifs === 3, `count = ${g2Notifs}`);

// A SECOND group whose notifications must survive g2's disband untouched.
const g3 = await api("POST", "/api/groups", {
  token: A.token,
  body: { name: "Keep Me", memberIds: [idB] },
});
const g3Id = g3.body?.group?._id;
await api("POST", `/api/groups/${g3Id}/members`, { token: A.token, body: { userId: idC } });
await api("PATCH", `/api/groups/${g3Id}/name`, { token: A.token, body: { name: "Keep Me Renamed" } });
const g3NotifsBefore = await Notification.countDocuments({ "data.groupId": g3Id });
check("g3 has its own notifications", g3NotifsBefore === 3, `count = ${g3NotifsBefore}`);

// A 1:1 notification with no group id at all, which must also survive.
const dmNotif = await Notification.create({
  recipient: idB,
  type: "new_message",
  data: { senderId: idA, groupId: null, preview: "unrelated dm" },
});

const nonAdminDisband = await api("DELETE", `/api/groups/${g2Id}`, { token: B.token });
check("non-admin disband -> 403", nonAdminDisband.status === 403, JSON.stringify(nonAdminDisband));
check("group survives a rejected disband", (await Group.countDocuments({ _id: g2Id })) === 1);
check("notifications survive a rejected disband",
  (await Notification.countDocuments({ "data.groupId": g2Id })) === 3);

const disbanded = await api("DELETE", `/api/groups/${g2Id}`, { token: A.token });
check("admin disband -> 200", disbanded.status === 200, JSON.stringify(disbanded));
check("reports 3 messages deleted", disbanded.body?.deletedMessages === 3,
  JSON.stringify(disbanded.body));
check("reports 3 notifications deleted", disbanded.body?.deletedNotifications === 3,
  JSON.stringify(disbanded.body));
check("group removed from MongoDB", (await Group.countDocuments({ _id: g2Id })) === 0);
check("group messages removed from MongoDB",
  (await Message.countDocuments({ group: g2Id })) === 0);
check("its added_to_group/group_renamed notifications removed",
  (await Notification.countDocuments({ "data.groupId": g2Id })) === 0);
check("OTHER group's notifications untouched",
  (await Notification.countDocuments({ "data.groupId": g3Id })) === g3NotifsBefore,
  `g3 now has ${await Notification.countDocuments({ "data.groupId": g3Id })}`);
check("groupless 1:1 notification untouched",
  (await Notification.countDocuments({ _id: dmNotif._id })) === 1);
check("unrelated 1:1 message untouched",
  (await Message.countDocuments({ _id: dm._id })) === 1);

const disbandAgain = await api("DELETE", `/api/groups/${g2Id}`, { token: A.token });
check("disbanding a deleted group -> 404", disbandAgain.status === 404, JSON.stringify(disbandAgain));

console.log("\nCleanup");
const wiped = await cleanup();
console.log("  removed:", JSON.stringify(wiped));
check("test users removed", (await User.countDocuments({ email: { $in: EMAILS } })) === 0);
check("test groups removed", (await Group.countDocuments({ _id: groupId })) === 0);

await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
