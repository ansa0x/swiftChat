import mongoose from "mongoose";
import dotenv from "dotenv";
import { io as ioClient } from "socket.io-client";

import User from "../src/models/User.js";
import Message from "../src/models/Message.js";
import Group from "../src/models/Group.js";
import Notification from "../src/models/Notification.js";

dotenv.config();

const API = "http://localhost:5000";
const SUFFIX = process.argv[2] ?? "1";
const A_EMAIL = `sockettest_a_${SUFFIX}@example.com`;
const B_EMAIL = `sockettest_b_${SUFFIX}@example.com`;

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

// Resolves with the first matching event, or null if it never arrives.
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

// Inverse: resolves true if the event does NOT fire within the window.
const expectSilence = async (socket, event, ms = 800) =>
  (await waitFor(socket, event, ms)) === null;

const connect = (token) =>
  new Promise((resolve, reject) => {
    const s = ioClient(API, { auth: { token }, transports: ["websocket"] });
    s.on("connect", () => resolve(s));
    s.on("connect_error", (err) => reject(err));
  });

const registerUser = async (username, email) => {
  const r = await fetch(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, password: "socketpassword123" }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`register ${email} -> ${r.status} ${JSON.stringify(body)}`);
  return body;
};

await mongoose.connect(process.env.MONGO_URI);

const cleanup = async () => {
  const users = await User.find({ email: { $in: [A_EMAIL, B_EMAIL] } }, "_id").lean();
  const ids = users.map((u) => u._id);
  const groups = await Group.find({ createdBy: { $in: ids } }, "_id").lean();
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

console.log("Auth");
let rejectedNoToken = null;
try {
  await connect(undefined);
} catch (e) {
  rejectedNoToken = e.message;
}
check("connection without token rejected", rejectedNoToken !== null, `got: ${rejectedNoToken}`);
console.log(`        -> ${rejectedNoToken}`);

let rejectedBadToken = null;
try {
  await connect("not-a-real-jwt");
} catch (e) {
  rejectedBadToken = e.message;
}
check("connection with invalid token rejected", rejectedBadToken !== null);
console.log(`        -> ${rejectedBadToken}`);

const userA = await registerUser(`sockettest_a_${SUFFIX}`, A_EMAIL);
const userB = await registerUser(`sockettest_b_${SUFFIX}`, B_EMAIL);
const idA = userA.user.id;
const idB = userB.user.id;

const a1 = await connect(userA.token);
const b1 = await connect(userB.token);
check("valid token connects (user A)", a1.connected);
check("valid token connects (user B)", b1.connected);

console.log("\nMulti-session presence");
const bSeesAOnline = waitFor(b1, "user_online");
const a2 = await connect(userA.token); // A's second device
check("same user opens a second session", a2.connected);
// A was already online from a1, so no second user_online should fire.
check("no duplicate user_online for second session", (await bSeesAOnline) === null);

const onlineList = await new Promise((resolve) => {
  const s = ioClient(API, { auth: { token: userB.token }, transports: ["websocket"] });
  s.on("online_users", (p) => {
    s.close();
    resolve(p.users);
  });
});
check("online_users includes A and B", onlineList.includes(idA) && onlineList.includes(idB),
  JSON.stringify(onlineList));

console.log("\n1:1 message");
const bReceives = waitFor(b1, "receive_message");
const a2Receives = waitFor(a2, "receive_message");
const a1Echo = expectSilence(a1, "receive_message", 1200);

const ack = await new Promise((resolve) =>
  a1.emit("send_message", { recipientId: idB, content: "hello from A" }, resolve)
);
check("sender gets ok ack", ack?.ok === true, JSON.stringify(ack));

const received = await bReceives;
check("recipient receives message", received?.content === "hello from A", JSON.stringify(received));
check("message carries sender id", received?.sender === idA);
check("message carries recipient id", received?.recipient === idB);
check("message has null group", received?.group === null);
check("message has id and createdAt", Boolean(received?.id && received?.createdAt));

const otherSession = await a2Receives;
check("sender's OTHER session receives it", otherSession?.id === received?.id, JSON.stringify(otherSession));
check("originating socket does not receive its own message", await a1Echo);

const persisted = await Message.findById(received.id).lean();
check("message persisted in MongoDB", persisted !== null);
check("persisted content matches", persisted?.content === "hello from A");
check("persisted sender matches", String(persisted?.sender) === idA);
check("persisted recipient matches", String(persisted?.recipient) === idB);

console.log("\nMessage validation");
const emptyAck = await new Promise((resolve) =>
  a1.emit("send_message", { recipientId: idB, content: "   " }, resolve)
);
check("empty content rejected", emptyAck?.ok === false, JSON.stringify(emptyAck));

const bothAck = await new Promise((resolve) =>
  a1.emit("send_message", { recipientId: idB, groupId: idB, content: "x" }, resolve)
);
check("both recipientId and groupId rejected", bothAck?.ok === false, JSON.stringify(bothAck));

const neitherAck = await new Promise((resolve) =>
  a1.emit("send_message", { content: "x" }, resolve)
);
check("neither recipientId nor groupId rejected", neitherAck?.ok === false, JSON.stringify(neitherAck));

console.log("\nTyping indicators");
const bTyping = waitFor(b1, "user_typing");
a1.emit("typing_start", { recipientId: idB });
const typingPayload = await bTyping;
check("recipient gets user_typing", typingPayload !== null, JSON.stringify(typingPayload));
check("user_typing includes sender id", typingPayload?.userId === idA);

const bStopped = waitFor(b1, "user_stopped_typing");
a1.emit("typing_stop", { recipientId: idB });
const stoppedPayload = await bStopped;
check("recipient gets user_stopped_typing", stoppedPayload !== null);
check("user_stopped_typing includes sender id", stoppedPayload?.userId === idA);

console.log("\nGroup messaging");
const group = await Group.create({
  name: `Socket Test Group ${SUFFIX}`,
  members: [idA, idB],
  admins: [idA],
  createdBy: idA,
});
const groupId = String(group._id);

const bGroupMsg = waitFor(b1, "receive_message");
const a2GroupMsg = waitFor(a2, "receive_message");
const groupAck = await new Promise((resolve) =>
  a1.emit("send_message", { groupId, content: "hello group" }, resolve)
);
check("group send acked", groupAck?.ok === true, JSON.stringify(groupAck));

const bGot = await bGroupMsg;
check("group member receives message", bGot?.content === "hello group", JSON.stringify(bGot));
check("group message carries group id", bGot?.group === groupId);
check("group message has null recipient", bGot?.recipient === null);
check("sender's other session gets group message", (await a2GroupMsg)?.id === bGot?.id);

const persistedGroup = await Message.findById(bGot.id).lean();
check("group message persisted", String(persistedGroup?.group) === groupId);

const outsiderGroup = await Group.create({
  name: `Outsider Group ${SUFFIX}`,
  members: [idB],
  admins: [idB],
  createdBy: idB,
});
const outsiderAck = await new Promise((resolve) =>
  a1.emit("send_message", { groupId: String(outsiderGroup._id), content: "sneaking in" }, resolve)
);
check("non-member cannot post to group", outsiderAck?.ok === false, JSON.stringify(outsiderAck));

console.log("\nDisconnect / presence");
const bSeesOfflineEarly = expectSilence(b1, "user_offline", 1200);
a1.close();
check("no user_offline while another session is alive", await bSeesOfflineEarly);

const bSeesOffline = waitFor(b1, "user_offline");
a2.close();
const offlinePayload = await bSeesOffline;
check("user_offline fires when last session closes", offlinePayload?.userId === idA,
  JSON.stringify(offlinePayload));

b1.close();

console.log("\nCleanup");
const removed = await cleanup();
console.log("  removed:", JSON.stringify(removed));
const leftoverUsers = await User.countDocuments({ email: { $in: [A_EMAIL, B_EMAIL] } });
const leftoverMsgs = await Message.countDocuments({ sender: { $in: [idA, idB] } });
check("test users removed", leftoverUsers === 0);
check("test messages removed", leftoverMsgs === 0);

await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
