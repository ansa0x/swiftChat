import "dotenv/config";
import mongoose from "mongoose";
import { io as ioClient } from "socket.io-client";

import User from "../src/models/User.js";
import Group from "../src/models/Group.js";
import Message from "../src/models/Message.js";
import Notification from "../src/models/Notification.js";

const API = "http://localhost:5000";
const SUFFIX = process.argv[2] ?? "1";
const EMAILS = ["a", "b", "c"].map((w) => `notiftest_${w}_${SUFFIX}@example.com`);

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

const waitFor = (socket, event, ms = 3000) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, ms);
    const handler = (payload) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });

const connect = (token) =>
  new Promise((resolve, reject) => {
    const s = ioClient(API, { auth: { token }, transports: ["websocket"] });
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });

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

const send = (socket, payload) =>
  new Promise((resolve) => socket.emit("send_message", payload, resolve));

const registerUser = async (who) => {
  const r = await api("POST", "/api/auth/register", {
    body: {
      username: `notiftest_${who}_${SUFFIX}`,
      email: `notiftest_${who}_${SUFFIX}@example.com`,
      password: "notifpassword123",
    },
  });
  if (r.status !== 201) throw new Error(`register ${who} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

await mongoose.connect(process.env.MONGO_URI);

const cleanup = async () => {
  const users = await User.find({ email: { $in: EMAILS } }, "_id").lean();
  const ids = users.map((u) => u._id);
  const groups = await Group.find({ members: { $in: ids } }, "_id").lean();
  const groupIds = groups.map((g) => g._id);

  const n = await Notification.deleteMany({ recipient: { $in: ids } });
  const m = await Message.deleteMany({
    $or: [{ sender: { $in: ids } }, { recipient: { $in: ids } }, { group: { $in: groupIds } }],
  });
  const g = await Group.deleteMany({ _id: { $in: groupIds } });
  const u = await User.deleteMany({ _id: { $in: ids } });
  return { notifications: n.deletedCount, messages: m.deletedCount, groups: g.deletedCount, users: u.deletedCount };
};

await cleanup();

const A = await registerUser("a");
const B = await registerUser("b");
const C = await registerUser("c");
const idA = A.user.id;
const idB = B.user.id;
const idC = C.user.id;

const countFor = (recipient, type) =>
  Notification.countDocuments(type ? { recipient, type } : { recipient });

console.log("1:1 message — recipient ONLINE");
let sockA = await connect(A.token);
let sockB = await connect(B.token);

const bNotif = waitFor(sockB, "new_notification");
const bMessage = waitFor(sockB, "receive_message");
const sent = await send(sockA, { recipientId: idB, content: "hello there" });
check("message sent ok", sent?.ok === true, JSON.stringify(sent));

const liveNotif = await bNotif;
check("recipient got new_notification over socket", liveNotif !== null, JSON.stringify(liveNotif));
check("notification type is new_message", liveNotif?.type === "new_message");
check("notification addressed to recipient", liveNotif?.recipient === idB);
check("data carries senderId", liveNotif?.data?.senderId === idA);
check("data carries a preview", liveNotif?.data?.preview === "hello there");
check("notification starts unread", liveNotif?.read === false);
check("receive_message still delivered alongside it", (await bMessage) !== null);

const persisted = await Notification.findById(liveNotif.id).lean();
check("notification persisted in MongoDB", persisted !== null);
check("persisted type matches", persisted?.type === "new_message");

const senderNotifs = await countFor(idA);
check("sender does NOT notify themselves", senderNotifs === 0, `sender has ${senderNotifs}`);

console.log("\n1:1 message — recipient OFFLINE");
sockB.close();
await new Promise((r) => setTimeout(r, 300));

const offlineSend = await send(sockA, { recipientId: idB, content: "you were away" });
check("message to offline user still sends", offlineSend?.ok === true, JSON.stringify(offlineSend));

await new Promise((r) => setTimeout(r, 500));
check("notification persisted while offline", (await countFor(idB, "new_message")) === 2,
  `count = ${await countFor(idB, "new_message")}`);

// On reconnecting, the user catches up through the REST endpoint.
sockB = await connect(B.token);
const listed = await api("GET", "/api/notifications", { token: B.token });
check("GET /api/notifications -> 200", listed.status === 200, JSON.stringify(listed.body));
check("both notifications returned", listed.body?.notifications?.length === 2,
  JSON.stringify(listed.body?.notifications?.length));
check("unreadCount is 2", listed.body?.unreadCount === 2);
check("newest first", listed.body?.notifications?.[0]?.data?.preview === "you were away",
  JSON.stringify(listed.body?.notifications?.map((n) => n.data?.preview)));

console.log("\nGroup triggers");
const sockC = await connect(C.token);

const created = await api("POST", "/api/groups", {
  token: A.token,
  body: { name: "Notify Group", memberIds: [idB] },
});
check("group created", created.status === 201, JSON.stringify(created.body));
const groupId = created.body?.group?._id;

// added_to_group
const cAdded = waitFor(sockC, "new_notification");
const addRes = await api("POST", `/api/groups/${groupId}/members`, {
  token: A.token,
  body: { userId: idC },
});
check("addMember -> 200", addRes.status === 200, JSON.stringify(addRes.body));
const addedNotif = await cAdded;
check("added member got socket notification", addedNotif !== null, JSON.stringify(addedNotif));
check("type is added_to_group", addedNotif?.type === "added_to_group");
check("data carries groupId", addedNotif?.data?.groupId === groupId);
check("data carries groupName", addedNotif?.data?.groupName === "Notify Group");
check("added_to_group persisted", (await countFor(idC, "added_to_group")) === 1);

// promoted_to_admin
const cPromoted = waitFor(sockC, "new_notification");
const promoteRes = await api("PATCH", `/api/groups/${groupId}/admins/${idC}/promote`, {
  token: A.token,
});
check("promote -> 200", promoteRes.status === 200, JSON.stringify(promoteRes.body));
const promoNotif = await cPromoted;
check("promoted member got socket notification", promoNotif !== null, JSON.stringify(promoNotif));
check("type is promoted_to_admin", promoNotif?.type === "promoted_to_admin");
check("promoted_to_admin persisted", (await countFor(idC, "promoted_to_admin")) === 1);

// group_renamed
const bRenamed = waitFor(sockB, "new_notification");
const cRenamed = waitFor(sockC, "new_notification");
const renameRes = await api("PATCH", `/api/groups/${groupId}/name`, {
  token: A.token,
  body: { name: "Renamed Notify Group" },
});
check("rename -> 200", renameRes.status === 200, JSON.stringify(renameRes.body));
const bRen = await bRenamed;
const cRen = await cRenamed;
check("member B notified of rename", bRen?.type === "group_renamed", JSON.stringify(bRen));
check("member C notified of rename", cRen?.type === "group_renamed", JSON.stringify(cRen));
check("rename data carries previousName", bRen?.data?.previousName === "Notify Group");
check("rename data carries new groupName", bRen?.data?.groupName === "Renamed Notify Group");
check("actor (A) NOT notified of own rename", (await countFor(idA, "group_renamed")) === 0);
check("group_renamed persisted for B", (await countFor(idB, "group_renamed")) === 1);
check("group_renamed persisted for C", (await countFor(idC, "group_renamed")) === 1);

// group message notifies every member except sender
const bGroupNotif = waitFor(sockB, "new_notification");
const cGroupNotif = waitFor(sockC, "new_notification");
const groupSend = await send(sockA, { groupId, content: "group ping" });
check("group message sent", groupSend?.ok === true, JSON.stringify(groupSend));
const bg = await bGroupNotif;
const cg = await cGroupNotif;
check("group message notified B", bg?.data?.groupId === groupId, JSON.stringify(bg));
check("group message notified C", cg?.data?.groupId === groupId, JSON.stringify(cg));
check("group notification carries groupName", bg?.data?.groupName === "Renamed Notify Group");
check("sender still not self-notified", (await countFor(idA)) === 0);

console.log("\nmark as read");
const cList = await api("GET", "/api/notifications", { token: C.token });
const cTotal = cList.body?.total;
check("C has 4 notifications", cTotal === 4, `got ${cTotal}`);
check("C unreadCount is 4", cList.body?.unreadCount === 4);

const targetId = cList.body.notifications[0].id;
const marked = await api("PATCH", `/api/notifications/${targetId}/read`, { token: C.token });
check("markAsRead -> 200", marked.status === 200, JSON.stringify(marked.body));
check("notification now read", marked.body?.notification?.read === true);
check("unreadCount dropped to 3", marked.body?.unreadCount === 3);
check("read state persisted",
  (await Notification.findById(targetId).lean())?.read === true);

const foreign = await api("PATCH", `/api/notifications/${targetId}/read`, { token: B.token });
check("cannot mark another user's notification -> 404", foreign.status === 404,
  JSON.stringify(foreign.body));

const badId = await api("PATCH", "/api/notifications/not-an-id/read", { token: C.token });
check("malformed id -> 400", badId.status === 400, JSON.stringify(badId.body));

const unauth = await api("GET", "/api/notifications");
check("no token -> 401", unauth.status === 401);

const unreadOnly = await api("GET", "/api/notifications?unread=true", { token: C.token });
check("unread filter returns 3", unreadOnly.body?.notifications?.length === 3,
  JSON.stringify(unreadOnly.body?.notifications?.length));

const paged = await api("GET", "/api/notifications?page=1&limit=2", { token: C.token });
check("limit respected", paged.body?.notifications?.length === 2);
check("hasMore true on first page", paged.body?.hasMore === true);
const page2 = await api("GET", "/api/notifications?page=2&limit=2", { token: C.token });
check("page 2 returns remainder", page2.body?.notifications?.length === 2);
check("hasMore false on last page", page2.body?.hasMore === false);
check("pages do not overlap",
  paged.body.notifications[0].id !== page2.body.notifications[0].id);

const all = await api("PATCH", "/api/notifications/read-all", { token: C.token });
check("markAllAsRead -> 200", all.status === 200, JSON.stringify(all.body));
check("reports 3 updated", all.body?.updated === 3, JSON.stringify(all.body));
check("unreadCount is 0", all.body?.unreadCount === 0);
check("no unread left in MongoDB",
  (await Notification.countDocuments({ recipient: idC, read: false })) === 0);
check("other users' notifications untouched",
  (await Notification.countDocuments({ recipient: idB, read: false })) > 0);

sockA.close();
sockB.close();
sockC.close();

console.log("\nCleanup");
const wiped = await cleanup();
console.log("  removed:", JSON.stringify(wiped));
check("no test notifications left",
  (await Notification.countDocuments({ recipient: { $in: [idA, idB, idC] } })) === 0);
check("no test users left",
  (await User.countDocuments({ email: { $in: EMAILS } })) === 0);

await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
