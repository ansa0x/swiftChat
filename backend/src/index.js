// Must come first: ESM evaluates every import below before this module's body,
// and config/cloudinary.js reads process.env at load time.
import "dotenv/config";

import http from "http";

import express from "express";
import cors from "cors";

import { connectDB } from "./lib/db.js";
import authRoutes from "./routes/authRoutes.js";
import groupRoutes from "./routes/groupRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import conversationRoutes from "./routes/conversationRoutes.js";
import { initSocketServer } from "./sockets/index.js";

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

initSocketServer(server);

app.use(express.json());
app.use(cors({ origin: "http://localhost:5173", credentials: true }));

app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", service: "SwiftChat API" });
});

app.use("/api/auth", authRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/users", userRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/conversations", conversationRoutes);

const startServer = async () => {
  try {
    await connectDB();
    server.listen(PORT, () => {
      console.log(`SwiftChat server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();
