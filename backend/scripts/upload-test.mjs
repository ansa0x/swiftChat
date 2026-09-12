import "dotenv/config";
import zlib from "zlib";
import mongoose from "mongoose";

import cloudinary from "../src/config/cloudinary.js";
import User from "../src/models/User.js";

const API = "http://localhost:5000";
const SUFFIX = process.argv[2] ?? "1";
const EMAIL = `uploadtest_${SUFFIX}@example.com`;
const FOLDER = "swiftchat/profile-photos";

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

// Minimal valid PNG of a solid colour — varying the colour changes the bytes,
// so the two uploads land on different Cloudinary public_ids.
const makePng = (w, h, rgb) => {
  const chunk = (tag, data) => {
    const body = Buffer.concat([Buffer.from(tag), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) >>> 0 : crc32(body));
    return Buffer.concat([len, body, crc]);
  };

  // Node's zlib exposes crc32 from v20.15; fall back to a local table if not.
  function crc32(buf) {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array(w).fill(Buffer.from(rgb)))]);
  const raw = Buffer.concat(Array(h).fill(row));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const postPhoto = async (token, buffer, filename, type) => {
  const form = new FormData();
  form.append("photo", new Blob([buffer], { type }), filename);

  const res = await fetch(`${API}/api/upload/profile-photo`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
};

const assetExists = (publicId) =>
  cloudinary.api
    .resource(publicId)
    .then(() => true)
    .catch((e) => (e?.error?.http_code === 404 ? false : `unexpected: ${e?.error?.message}`));

await mongoose.connect(process.env.MONGO_URI);

// Remove any user (and asset) left by an earlier run.
const priorUser = await User.findOne({ email: EMAIL }).lean();
if (priorUser?.profilePhotoId) {
  await cloudinary.uploader.destroy(priorUser.profilePhotoId).catch(() => {});
}
await User.deleteMany({ email: EMAIL });

const reg = await fetch(`${API}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    username: `uploadtest_${SUFFIX}`,
    email: EMAIL,
    password: "uploadpassword123",
  }),
});
const regBody = await reg.json();
if (reg.status !== 201) {
  throw new Error(`register -> ${reg.status} ${JSON.stringify(regBody)}`);
}
const token = regBody.token;
check("new user starts with empty profilePhotoId", regBody.user.profilePhoto === "");

console.log("\nSpoofed non-image (text sent as image/png)");
const spoof = await postPhoto(
  token,
  Buffer.from("this is definitely not an image\n"),
  "sneaky.png",
  "image/png"
);
check("spoofed file -> 400 (not 500)", spoof.status === 400, `got ${spoof.status} ${JSON.stringify(spoof.body)}`);
check("message is clear", /not a valid image/i.test(spoof.body?.message ?? ""),
  JSON.stringify(spoof.body));
console.log(`        -> ${spoof.body?.message}`);

const afterSpoof = await User.findOne({ email: EMAIL }).lean();
check("failed upload left profilePhoto empty", afterSpoof?.profilePhoto === "");
check("failed upload left profilePhotoId empty", !afterSpoof?.profilePhotoId);

console.log("\nFirst upload");
const first = await postPhoto(token, makePng(64, 64, [70, 130, 200]), "first.png", "image/png");
check("first upload -> 200", first.status === 200, JSON.stringify(first.body));
const firstId = first.body?.photo?.publicId;
check("returned a publicId", Boolean(firstId));
check("user.profilePhotoId set", first.body?.user?.profilePhotoId === firstId,
  JSON.stringify(first.body?.user));

const dbAfterFirst = await User.findOne({ email: EMAIL }).lean();
check("profilePhotoId persisted in MongoDB", dbAfterFirst?.profilePhotoId === firstId);
check("profilePhoto persisted in MongoDB", dbAfterFirst?.profilePhoto === first.body?.photo?.url);
check("first asset exists on Cloudinary", (await assetExists(firstId)) === true);

console.log("\nSecond upload (should delete the first asset)");
const second = await postPhoto(token, makePng(48, 48, [220, 90, 60]), "second.png", "image/png");
check("second upload -> 200", second.status === 200, JSON.stringify(second.body));
const secondId = second.body?.photo?.publicId;
check("second publicId differs from first", Boolean(secondId) && secondId !== firstId,
  `first=${firstId} second=${secondId}`);

const dbAfterSecond = await User.findOne({ email: EMAIL }).lean();
check("profilePhotoId now points at the second asset", dbAfterSecond?.profilePhotoId === secondId);
check("profilePhoto now points at the second url", dbAfterSecond?.profilePhoto === second.body?.photo?.url);

check("FIRST asset deleted from Cloudinary", (await assetExists(firstId)) === false,
  `assetExists(first) = ${await assetExists(firstId)}`);
check("second asset still on Cloudinary", (await assetExists(secondId)) === true);

const liveSecond = await fetch(second.body.photo.url);
check("second url serves a live image", liveSecond.status === 200 &&
  (liveSecond.headers.get("content-type") ?? "").startsWith("image/"),
  `${liveSecond.status} ${liveSecond.headers.get("content-type")}`);

console.log("\nCleanup");
if (secondId) {
  const destroyed = await cloudinary.uploader.destroy(secondId);
  console.log("  destroy second asset:", JSON.stringify(destroyed));
}
const del = await User.deleteMany({ email: EMAIL });
console.log("  users deleted:", del.deletedCount);

const remaining = await cloudinary.api.resources({
  type: "upload",
  prefix: FOLDER,
  max_results: 100,
});
console.log("  assets left in", FOLDER + ":", remaining.resources.length);
check("no assets left in the folder", remaining.resources.length === 0,
  JSON.stringify(remaining.resources.map((r) => r.public_id)));
check("no test users left", (await User.countDocuments({ email: EMAIL })) === 0);

await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
