# SwiftChat

A real-time chat app. You can message people one-on-one or in groups, and
everything updates live over Socket.IO instead of needing a refresh.

Built with the MERN stack (MongoDB, Express, React, Node) plus Socket.IO for
the real-time parts.

## Features

- Sign up and log in with JWT auth. Passwords are hashed with bcrypt.
- One-to-one messaging in real time.
- Group chat.
- Typing indicators. Works for groups too, so it says "Alice and Bob are
  typing..." when more than one person is typing at once.
- Multi-session support. You can be logged in on your laptop and phone at the
  same time and both sessions stay in sync. You only show as offline once the
  last one disconnects.
- Full group admin stuff: create a group, rename it, add and remove members,
  promote and demote admins, leave, and disband. All of these update live for
  everyone in the group, so nobody has to refresh to see the change.
- You can't remove or demote the last admin, otherwise a group could end up
  with nobody able to manage it.
- Read receipts. Opening a thread marks it read on the server, so the unread
  badge stays cleared after a refresh.
- In-app notifications with a bell icon and an unread count. Covers new
  messages, being added to a group, being made an admin, and group renames.
- Profile photo uploads through Cloudinary. The old photo gets deleted when
  you upload a new one so they don't pile up.
- Rate limiting on the auth routes so you can't brute force a login.

## Tech stack

Backend:

- Node and Express
- MongoDB with Mongoose
- Socket.IO
- jsonwebtoken and bcrypt for auth
- multer and Cloudinary for image uploads
- express-rate-limit

Frontend:

- React with Vite
- react-router-dom
- axios
- socket.io-client

## Getting started

You need Node installed and a MongoDB database (I used MongoDB Atlas). You
also need a Cloudinary account if you want profile photo uploads to work.

Run the backend and frontend in two separate terminals.

Backend:

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

Then fill in your own values in `backend/.env`. It runs on port 5000.

Frontend:

```bash
cd frontend
npm install
npm run dev
```

That runs on port 5173. The backend CORS config expects that exact port, so if
you change it you have to change it in `backend/src/index.js` too.

## Environment variables

These go in `backend/.env`. There's no `.env` needed for the frontend.

| Variable | Required | What it's for |
| --- | --- | --- |
| `MONGO_URI` | yes | MongoDB connection string |
| `JWT_SECRET` | yes | Secret used to sign auth tokens. Use something long and random. |
| `PORT` | no | Port the server listens on. Defaults to 5000. |
| `CLOUDINARY_CLOUD_NAME` | for uploads | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | for uploads | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | for uploads | Cloudinary API secret |
| `NODE_ENV` | no | Set to `production` in deployment. Turns on trusting one proxy hop. |
| `TRUST_PROXY` | no | Number of proxy hops to trust, if your host uses more than one. Leave it unset locally. |

If the Cloudinary values are missing the server still starts, it just logs a
warning and uploads will fail.

## API routes

Everything is under `/api`. All routes need an
`Authorization: Bearer <token>` header except register, login, and health.

Auth:

- `POST /api/auth/register` - rate limited to 5 per hour per IP
- `POST /api/auth/login` - rate limited to 10 per 15 minutes per IP

Users:

- `GET /api/users` - everyone except you, for starting a new chat

Conversations:

- `GET /api/conversations` - your 1:1 threads and groups in one list, sorted by
  most recent, with last message and unread count

Messages:

- `GET /api/messages/:userId` - 1:1 history with that person
- `GET /api/messages/group/:groupId` - group history

Groups:

- `POST /api/groups` - create a group
- `GET /api/groups/:groupId` - group details with members and admins
- `DELETE /api/groups/:groupId` - disband (admin only)
- `POST /api/groups/:groupId/leave` - leave the group
- `PATCH /api/groups/:groupId/name` - rename (admin only)
- `POST /api/groups/:groupId/members` - add a member (admin only)
- `DELETE /api/groups/:groupId/members/:userId` - remove a member (admin only)
- `PATCH /api/groups/:groupId/admins/:userId/promote` - promote (admin only)
- `PATCH /api/groups/:groupId/admins/:userId/demote` - demote (admin only)

Notifications:

- `GET /api/notifications` - paginated, newest first. Takes `page`, `limit`,
  and `unread=true`.
- `PATCH /api/notifications/read-all` - mark everything read
- `PATCH /api/notifications/:id/read` - mark one read

Upload:

- `POST /api/upload/profile-photo` - multipart form, field name `photo`.
  Images only, 5MB max.

Health:

- `GET /api/health` - no auth, just returns ok

## Socket.IO events

The client connects with the JWT in the handshake:

```js
io("http://localhost:5000", { auth: { token } })
```

Connections without a valid token get rejected.

Client sends:

| Event | Payload | Notes |
| --- | --- | --- |
| `send_message` | `{ recipientId \| groupId, content }` | Takes an ack callback that returns `{ ok, message }` or `{ ok: false, error }` |
| `mark_read` | `{ senderId \| groupId }` | Marks that thread read |
| `typing_start` | `{ recipientId \| groupId }` | |
| `typing_stop` | `{ recipientId \| groupId }` | |

Server sends:

| Event | Payload | When |
| --- | --- | --- |
| `receive_message` | the saved message | A message arrives. Also goes to your other sessions. |
| `message_error` | `{ message }` | A send failed |
| `user_typing` | `{ userId, groupId }` | Someone started typing |
| `user_stopped_typing` | `{ userId, groupId }` | Someone stopped |
| `user_online` | `{ userId }` | Someone's first session connects |
| `user_offline` | `{ userId }` | Their last session disconnects |
| `online_users` | `{ users }` | Sent to you on connect |
| `new_notification` | the notification | A new notification was created for you |
| `messages_read` | `{ readBy, senderId \| groupId }` | Someone read your messages |
| `group_membership_changed` | `{ groupId, type, groupName, updatedMembers, updatedAdmins, affectedUserId }` | Someone was added, removed, promoted, demoted, left, or the group was renamed. `type` says which. |
| `group_disbanded` | `{ groupId, groupName, disbandedBy }` | A group was deleted |
| `profile_updated` | `{ userId, username, profilePhoto }` | Someone changed their profile photo |

A note on `send_message`: the socket that sent it doesn't get
`receive_message` back, it gets the ack instead. Otherwise the sender would
see their own message twice.

## Test scripts

There are some integration test scripts in `backend/scripts`. They hit a real
running server and a real database, so start the backend first. Each one
creates its own test users and deletes them again at the end.

```bash
cd backend
npm run test:sockets
npm run test:groups
npm run test:upload
npm run test:notifications
```

`test:upload` needs working Cloudinary credentials.
