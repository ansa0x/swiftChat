# SwiftChat

A real-time chat application. The backend is an Express + MongoDB API with JWT auth and a Socket.IO layer for live messaging, typing indicators, and presence.

## Getting started

```bash
cd backend
npm install
cp .env.example .env   # then fill in MONGO_URI and JWT_SECRET
npm run dev
```

The server listens on `PORT` (default `5000`).

### Environment

| Variable | Purpose |
| --- | --- |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret used to sign JWT auth tokens |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Image uploads (not yet wired up) |
| `PORT` | Port the server listens on |

## API

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness check |
| `POST` | `/api/auth/register` | Rate limited to 5/hour per IP |
| `POST` | `/api/auth/login` | Rate limited to 10/15min per IP |

## Socket.IO

Clients authenticate on the handshake with `auth: { token }`, using the JWT from register or login.

| Direction | Event | Payload |
| --- | --- | --- |
| → server | `send_message` | `{ recipientId \| groupId, content }`, optional ack `{ ok, message }` |
| → server | `typing_start` / `typing_stop` | `{ recipientId \| groupId }` |
| ← client | `receive_message` | the saved message |
| ← client | `user_typing` / `user_stopped_typing` | `{ userId, groupId }` |
| ← client | `user_online` / `user_offline` | `{ userId }` |
| ← client | `online_users` | `{ users }`, sent on connect |

Integration test (creates its own users and cleans up after itself):

```bash
npm run test:sockets
```

## Before deploy

These three are fine for local development but will break or silently misbehave in production. Address them before going live on Render.

1. **Rate limiter uses an in-memory store.** Counts reset on every restart and are per-process, so running multiple instances multiplies the effective limit — swap in a shared store (`rate-limit-redis`) before scaling past one instance.
2. **Socket.IO presence map is in-process.** Each instance only knows its own connections, so users on different instances can't see or message each other — add `@socket.io/redis-adapter` before scaling past one instance.
3. **`trust proxy` is not set.** Behind Render's proxy every request appears to come from the proxy's IP, so all users share one rate-limit bucket — set `app.set("trust proxy", 1)` in `backend/src/index.js`, matching the actual number of proxy hops (never blanket `true`, which lets clients spoof `X-Forwarded-For` and bypass the limit).
