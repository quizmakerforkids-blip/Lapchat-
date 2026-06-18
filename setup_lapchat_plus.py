
import os
import json

PACKAGE_JSON = {
    "name": "lapchat",
    "version": "2.0.0",
    "type": "module",
    "private": True,
    "scripts": {
        "client": "vite --host 127.0.0.1 --port 8570",
        "server": "nodemon server/index.cjs",
        "dev:full": "concurrently \"npm run server\" \"npm run client\"",
        "dev": "vite --host 127.0.0.1 --port 8570",
        "build": "vite build",
        "preview": "vite preview"
    },
    "dependencies": {
        "@vitejs/plugin-react": "latest",
        "vite": "latest",
        "react": "latest",
        "react-dom": "latest",
        "express": "latest",
        "socket.io": "latest",
        "socket.io-client": "latest",
        "cors": "latest",
        "multer": "latest",
        "bcryptjs": "latest",
        "lucide-react": "latest"
    },
    "devDependencies": {
        "nodemon": "latest",
        "concurrently": "latest"
    }
}

INDEX_HTML = """<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>LapChat Plus</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
"""

SERVER = r"""
const express = require("express");
const http = require("http");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");

const PORT = 8020;
const DB_FILE = path.join(__dirname, "db.json");
const UPLOAD_DIR = path.join(__dirname, "uploads");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] }
});

app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use("/uploads", express.static(UPLOAD_DIR));

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 500 * 1024 * 1024 }
});

function defaultDb() {
  return {
    users: [],
    friends: [],
    servers: [],
    serverMembers: [],
    channels: [],
    conversations: [],
    conversationMembers: [],
    messages: [],
    notes: [],
    bans: [],
    nextServerId: 1,
    nextChannelId: 1,
    nextConversationId: 1,
    nextMessageId: 1,
    nextNoteId: 1
  };
}

function migrate(db) {
  db.users ||= [];
  db.friends ||= [];
  db.servers ||= [];
  db.serverMembers ||= [];
  db.channels ||= [];
  db.conversations ||= [];
  db.conversationMembers ||= [];
  db.messages ||= [];
  db.notes ||= [];
  db.bans ||= [];
  db.nextServerId ||= 1;
  db.nextChannelId ||= 1;
  db.nextConversationId ||= 1;
  db.nextMessageId ||= 1;
  db.nextNoteId ||= 1;

  for (const u of db.users) {
    u.bio ||= "";
    u.avatar ||= "";
    u.accent ||= "#00d9ff";
    u.banner ||= "";
    u.status ||= "online";
    u.customStatus ||= "";
    u.theme ||= "neon";
    u.density ||= "comfortable";
  }

  for (const m of db.messages) {
    m.edited ??= false;
    m.deleted ??= false;
    m.pinned ??= false;
    m.reactions ||= {};
    m.replies ||= [];
  }

  return db;
}

function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb(), null, 2));
  }
  return migrate(JSON.parse(fs.readFileSync(DB_FILE, "utf8")));
}

function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(migrate(db), null, 2));
}

function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function publicUser(user) {
  if (!user) return null;
  return {
    username: user.username,
    bio: user.bio || "",
    avatar: user.avatar || "",
    banner: user.banner || "",
    accent: user.accent || "#00d9ff",
    theme: user.theme || "neon",
    density: user.density || "comfortable",
    status: user.status || "online",
    customStatus: user.customStatus || ""
  };
}

function emitRefresh(type, data = {}) {
  io.emit("refresh", { type, ...data });
}

function findUser(db, username) {
  return db.users.find((u) => u.username === username);
}

function serverRole(db, serverId, username) {
  return db.serverMembers.find((m) => m.serverId === Number(serverId) && m.username === username)?.role || "";
}

function isOwnerOrAdmin(db, serverId, username) {
  const role = serverRole(db, serverId, username);
  return role === "owner" || role === "admin";
}

app.get("/api/health", (req, res) => res.json({ ok: true, app: "LapChat Plus", status: "running" }));

app.post("/api/auth/signup", async (req, res) => {
  const db = loadDb();
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "").trim();
  if (!username || !password) return res.json({ ok: false, error: "Username and password required." });
  if (db.users.find((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.json({ ok: false, error: "Username already exists." });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  db.users.push({
    username, passwordHash, bio: "", avatar: "", banner: "",
    accent: "#00d9ff", theme: "neon", density: "comfortable",
    status: "online", customStatus: ""
  });

  const serverId = db.nextServerId++;
  db.servers.push({ id: serverId, name: `${username}'s Server`, owner: username, icon: "", description: "", createdAt: now() });
  db.serverMembers.push({ serverId, username, role: "owner", nickname: "" });
  for (const channelName of ["general", "gaming", "media", "announcements"]) {
    db.channels.push({ id: db.nextChannelId++, serverId, name: channelName, type: "text", topic: "" });
  }

  saveDb(db);
  res.json({ ok: true });
});

app.post("/api/auth/login", async (req, res) => {
  const db = loadDb();
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "").trim();
  const user = findUser(db, username);
  if (!user) return res.json({ ok: false, error: "Account not found." });
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.json({ ok: false, error: "Wrong password." });
  user.status = "online";
  saveDb(db);
  emitRefresh("presence");
  res.json({ ok: true, user: publicUser(user) });
});

app.post("/api/status", (req, res) => {
  const db = loadDb();
  const username = String(req.body.username || "");
  const status = String(req.body.status || "online");
  const customStatus = String(req.body.customStatus || "");
  const user = findUser(db, username);
  if (!user) return res.json({ ok: false, error: "User not found." });
  user.status = status;
  user.customStatus = customStatus;
  saveDb(db);
  emitRefresh("presence");
  res.json({ ok: true, user: publicUser(user) });
});

app.post("/api/settings", async (req, res) => {
  const db = loadDb();
  const oldUsername = String(req.body.oldUsername || "").trim();
  const newUsername = String(req.body.newUsername || "").trim();
  const newPassword = String(req.body.newPassword || "").trim();
  const user = findUser(db, oldUsername);
  if (!user) return res.json({ ok: false, error: "User not found." });

  if (newUsername && newUsername !== oldUsername) {
    if (findUser(db, newUsername)) return res.json({ ok: false, error: "Username already taken." });
    user.username = newUsername;
    for (const s of db.servers) if (s.owner === oldUsername) s.owner = newUsername;
    for (const m of db.serverMembers) if (m.username === oldUsername) m.username = newUsername;
    for (const f of db.friends) {
      if (f.requester === oldUsername) f.requester = newUsername;
      if (f.receiver === oldUsername) f.receiver = newUsername;
    }
    for (const c of db.conversations) if (c.owner === oldUsername) c.owner = newUsername;
    for (const cm of db.conversationMembers) if (cm.username === oldUsername) cm.username = newUsername;
    for (const msg of db.messages) if (msg.sender === oldUsername) msg.sender = newUsername;
  }

  if (newPassword) user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.bio = String(req.body.bio || "");
  user.avatar = String(req.body.avatar || "");
  user.banner = String(req.body.banner || "");
  user.accent = String(req.body.accent || "#00d9ff");
  user.theme = String(req.body.theme || "neon");
  user.density = String(req.body.density || "comfortable");
  user.customStatus = String(req.body.customStatus || "");

  saveDb(db);
  emitRefresh("settings");
  res.json({ ok: true, user: publicUser(user) });
});

app.get("/api/users/search", (req, res) => {
  const db = loadDb();
  const q = String(req.query.q || "").toLowerCase();
  const current = String(req.query.current || "");
  const users = db.users
    .filter((u) => u.username !== current)
    .filter((u) => u.username.toLowerCase().includes(q))
    .slice(0, 25)
    .map(publicUser);
  res.json({ ok: true, users });
});

app.get("/api/friends", (req, res) => {
  const db = loadDb();
  const username = String(req.query.username || "");
  const friends = db.friends
    .filter((f) => f.status === "accepted")
    .filter((f) => f.requester === username || f.receiver === username)
    .map((f) => publicUser(findUser(db, f.requester === username ? f.receiver : f.requester)))
    .filter(Boolean);
  res.json({ ok: true, friends });
});

app.get("/api/friends/requests", (req, res) => {
  const db = loadDb();
  const username = String(req.query.username || "");
  res.json({ ok: true, requests: db.friends.filter((f) => f.receiver === username && f.status === "pending") });
});

app.post("/api/friends/request", (req, res) => {
  const db = loadDb();
  const requester = String(req.body.requester || "").trim();
  const receiver = String(req.body.receiver || "").trim();
  if (!requester || !receiver) return res.json({ ok: false, error: "Missing username." });
  if (requester === receiver) return res.json({ ok: false, error: "You cannot add yourself." });
  if (!findUser(db, receiver)) return res.json({ ok: false, error: "User not found." });
  const exists = db.friends.find((f) => (f.requester === requester && f.receiver === receiver) || (f.requester === receiver && f.receiver === requester));
  if (exists) return res.json({ ok: false, error: "Request or friendship already exists." });
  db.friends.push({ requester, receiver, status: "pending", createdAt: now() });
  saveDb(db);
  emitRefresh("friend_request");
  res.json({ ok: true });
});

app.post("/api/friends/accept", (req, res) => {
  const db = loadDb();
  const username = String(req.body.username || "");
  const requester = String(req.body.requester || "");
  const request = db.friends.find((f) => f.requester === requester && f.receiver === username && f.status === "pending");
  if (request) request.status = "accepted";
  saveDb(db);
  emitRefresh("friend_accept");
  res.json({ ok: true });
});

app.delete("/api/friends/:friend", (req, res) => {
  const db = loadDb();
  const username = String(req.query.username || "");
  const friend = String(req.params.friend || "");
  db.friends = db.friends.filter((f) => !((f.requester === username && f.receiver === friend) || (f.requester === friend && f.receiver === username)));
  saveDb(db);
  emitRefresh("friend_remove");
  res.json({ ok: true });
});

app.get("/api/servers", (req, res) => {
  const db = loadDb();
  const username = String(req.query.username || "");
  const servers = db.serverMembers.filter((m) => m.username === username).map((m) => {
    const server = db.servers.find((s) => s.id === m.serverId);
    return server ? { ...server, role: m.role, nickname: m.nickname || "" } : null;
  }).filter(Boolean);
  res.json({ ok: true, servers });
});

app.post("/api/servers", (req, res) => {
  const db = loadDb();
  const owner = String(req.body.owner || "").trim();
  const name = String(req.body.name || "").trim();
  if (!owner || !name) return res.json({ ok: false, error: "Server name required." });
  const serverId = db.nextServerId++;
  db.servers.push({ id: serverId, name, owner, icon: "", description: "", createdAt: now() });
  db.serverMembers.push({ serverId, username: owner, role: "owner", nickname: "" });
  db.channels.push({ id: db.nextChannelId++, serverId, name: "general", type: "text", topic: "" });
  saveDb(db);
  emitRefresh("server_create");
  res.json({ ok: true, serverId });
});

app.put("/api/servers/:serverId", (req, res) => {
  const db = loadDb();
  const serverId = Number(req.params.serverId);
  const username = String(req.body.username || "");
  const server = db.servers.find((s) => s.id === serverId);
  if (!server) return res.json({ ok: false, error: "Server not found." });
  if (!isOwnerOrAdmin(db, serverId, username)) return res.json({ ok: false, error: "No permission." });
  server.name = String(req.body.name || server.name);
  server.description = String(req.body.description || "");
  server.icon = String(req.body.icon || "");
  saveDb(db);
  emitRefresh("server_update");
  res.json({ ok: true, server });
});

app.post("/api/servers/invite", (req, res) => {
  const db = loadDb();
  const serverId = Number(req.body.serverId);
  const inviter = String(req.body.inviter || "");
  const username = String(req.body.username || "");
  if (!isOwnerOrAdmin(db, serverId, inviter)) return res.json({ ok: false, error: "Only admins can invite users." });
  if (!findUser(db, username)) return res.json({ ok: false, error: "User not found." });
  if (db.serverMembers.find((m) => m.serverId === serverId && m.username === username)) return res.json({ ok: false, error: "User already in server." });
  db.serverMembers.push({ serverId, username, role: "member", nickname: "" });
  saveDb(db);
  emitRefresh("server_invite");
  res.json({ ok: true });
});

app.post("/api/servers/:serverId/role", (req, res) => {
  const db = loadDb();
  const serverId = Number(req.params.serverId);
  const actor = String(req.body.actor || "");
  const username = String(req.body.username || "");
  const role = String(req.body.role || "member");
  if (serverRole(db, serverId, actor) !== "owner") return res.json({ ok: false, error: "Only owner can change roles." });
  const member = db.serverMembers.find((m) => m.serverId === serverId && m.username === username);
  if (!member) return res.json({ ok: false, error: "Member not found." });
  if (member.role === "owner") return res.json({ ok: false, error: "Cannot change owner role." });
  member.role = role;
  saveDb(db);
  emitRefresh("role_update");
  res.json({ ok: true });
});

app.delete("/api/servers/:serverId/members/:username", (req, res) => {
  const db = loadDb();
  const serverId = Number(req.params.serverId);
  const username = String(req.params.username || "");
  const actor = String(req.query.actor || "");
  if (!isOwnerOrAdmin(db, serverId, actor)) return res.json({ ok: false, error: "No permission." });
  db.serverMembers = db.serverMembers.filter((m) => !(m.serverId === serverId && m.username === username && m.role !== "owner"));
  saveDb(db);
  emitRefresh("member_kick");
  res.json({ ok: true });
});

app.get("/api/servers/:serverId/members", (req, res) => {
  const db = loadDb();
  const serverId = Number(req.params.serverId);
  const members = db.serverMembers.filter((m) => m.serverId === serverId).map((m) => ({ ...m, profile: publicUser(findUser(db, m.username)) }));
  res.json({ ok: true, members });
});

app.get("/api/servers/:serverId/channels", (req, res) => {
  const db = loadDb();
  const serverId = Number(req.params.serverId);
  res.json({ ok: true, channels: db.channels.filter((c) => c.serverId === serverId) });
});

app.post("/api/channels", (req, res) => {
  const db = loadDb();
  const serverId = Number(req.body.serverId);
  const username = String(req.body.username || "");
  const name = String(req.body.name || "").trim().toLowerCase();
  const topic = String(req.body.topic || "");
  if (!isOwnerOrAdmin(db, serverId, username)) return res.json({ ok: false, error: "No permission." });
  if (!name) return res.json({ ok: false, error: "Channel name required." });
  db.channels.push({ id: db.nextChannelId++, serverId, name, type: "text", topic });
  saveDb(db);
  emitRefresh("channel_create");
  res.json({ ok: true });
});

app.put("/api/channels/:channelId", (req, res) => {
  const db = loadDb();
  const channelId = Number(req.params.channelId);
  const channel = db.channels.find((c) => c.id === channelId);
  if (!channel) return res.json({ ok: false, error: "Channel not found." });
  channel.name = String(req.body.name || channel.name).trim().toLowerCase();
  channel.topic = String(req.body.topic || "");
  saveDb(db);
  emitRefresh("channel_rename");
  res.json({ ok: true });
});

app.delete("/api/channels/:channelId", (req, res) => {
  const db = loadDb();
  const channelId = Number(req.params.channelId);
  db.channels = db.channels.filter((c) => c.id !== channelId);
  db.messages = db.messages.filter((m) => !(m.scope === "channel" && m.targetId === channelId));
  saveDb(db);
  emitRefresh("channel_delete");
  res.json({ ok: true });
});

app.get("/api/conversations", (req, res) => {
  const db = loadDb();
  const username = String(req.query.username || "");
  const conversations = db.conversationMembers.filter((m) => m.username === username).map((m) => {
    const convo = db.conversations.find((c) => c.id === m.conversationId);
    if (!convo) return null;
    const members = db.conversationMembers.filter((cm) => cm.conversationId === convo.id).map((cm) => cm.username);
    let name = convo.name;
    if (convo.type === "dm") name = members.find((x) => x !== username) || convo.name;
    return { ...convo, name, members };
  }).filter(Boolean);
  res.json({ ok: true, conversations });
});

app.post("/api/conversations/dm", (req, res) => {
  const db = loadDb();
  const user = String(req.body.user || "");
  const friend = String(req.body.friend || "");
  const friendship = db.friends.find((f) => f.status === "accepted" && ((f.requester === user && f.receiver === friend) || (f.requester === friend && f.receiver === user)));
  if (!friendship) return res.json({ ok: false, error: "You must be friends first." });
  const existing = db.conversations.find((c) => {
    if (c.type !== "dm") return false;
    const members = db.conversationMembers.filter((m) => m.conversationId === c.id).map((m) => m.username);
    return members.includes(user) && members.includes(friend);
  });
  if (existing) return res.json({ ok: true, conversationId: existing.id });
  const id = db.nextConversationId++;
  db.conversations.push({ id, name: `${user}/${friend}`, type: "dm", owner: user, createdAt: now() });
  db.conversationMembers.push({ conversationId: id, username: user });
  db.conversationMembers.push({ conversationId: id, username: friend });
  saveDb(db);
  emitRefresh("dm_create");
  res.json({ ok: true, conversationId: id });
});

app.post("/api/conversations/group", (req, res) => {
  const db = loadDb();
  const owner = String(req.body.owner || "");
  const name = String(req.body.name || "").trim();
  const members = Array.isArray(req.body.members) ? req.body.members : [];
  if (!name) return res.json({ ok: false, error: "Group name required." });
  const id = db.nextConversationId++;
  db.conversations.push({ id, name, type: "group", owner, icon: "", createdAt: now() });
  const unique = new Set([owner]);
  for (const m of members) if (findUser(db, String(m || "").trim())) unique.add(String(m).trim());
  for (const username of unique) db.conversationMembers.push({ conversationId: id, username });
  saveDb(db);
  emitRefresh("group_create");
  res.json({ ok: true, conversationId: id });
});

app.post("/api/conversations/:conversationId/members", (req, res) => {
  const db = loadDb();
  const conversationId = Number(req.params.conversationId);
  const owner = String(req.body.owner || "");
  const username = String(req.body.username || "");
  const convo = db.conversations.find((c) => c.id === conversationId);
  if (!convo || convo.type !== "group") return res.json({ ok: false, error: "Group not found." });
  if (convo.owner !== owner) return res.json({ ok: false, error: "Only group owner can add members." });
  if (!findUser(db, username)) return res.json({ ok: false, error: "User not found." });
  if (db.conversationMembers.find((m) => m.conversationId === conversationId && m.username === username)) return res.json({ ok: false, error: "User already in group." });
  db.conversationMembers.push({ conversationId, username });
  saveDb(db);
  emitRefresh("group_member_add");
  res.json({ ok: true });
});

app.get("/api/conversations/:conversationId/members", (req, res) => {
  const db = loadDb();
  const conversationId = Number(req.params.conversationId);
  const members = db.conversationMembers.filter((m) => m.conversationId === conversationId).map((m) => publicUser(findUser(db, m.username))).filter(Boolean);
  res.json({ ok: true, members });
});

app.get("/api/messages", (req, res) => {
  const db = loadDb();
  const scope = String(req.query.scope || "");
  const targetId = Number(req.query.targetId);
  let messages = db.messages.filter((m) => m.scope === scope && m.targetId === targetId);
  const q = String(req.query.q || "").toLowerCase();
  if (q) messages = messages.filter((m) => m.content.toLowerCase().includes(q) || m.sender.toLowerCase().includes(q));
  res.json({ ok: true, messages });
});

app.post("/api/messages", (req, res) => {
  const db = loadDb();
  const scope = String(req.body.scope || "");
  const targetId = Number(req.body.targetId);
  const sender = String(req.body.sender || "");
  const content = String(req.body.content || "").trim();
  const type = String(req.body.type || "text");
  const replyTo = req.body.replyTo ? Number(req.body.replyTo) : null;
  if (!scope || !targetId || !sender || !content) return res.json({ ok: false, error: "Missing message data." });
  const message = {
    id: db.nextMessageId++, scope, targetId, sender, content, type,
    replyTo, edited: false, deleted: false, pinned: false, reactions: {},
    createdAt: now()
  };
  db.messages.push(message);
  saveDb(db);
  emitRefresh("message", { scope, targetId });
  res.json({ ok: true, message });
});

app.put("/api/messages/:messageId", (req, res) => {
  const db = loadDb();
  const messageId = Number(req.params.messageId);
  const sender = String(req.body.sender || "");
  const content = String(req.body.content || "").trim();
  const msg = db.messages.find((m) => m.id === messageId);
  if (!msg) return res.json({ ok: false, error: "Message not found." });
  if (msg.sender !== sender) return res.json({ ok: false, error: "You can only edit your own messages." });
  msg.content = content;
  msg.edited = true;
  saveDb(db);
  emitRefresh("message_edit");
  res.json({ ok: true });
});

app.delete("/api/messages/:messageId", (req, res) => {
  const db = loadDb();
  const messageId = Number(req.params.messageId);
  const sender = String(req.query.sender || "");
  const msg = db.messages.find((m) => m.id === messageId);
  if (!msg) return res.json({ ok: false, error: "Message not found." });
  if (msg.sender !== sender) return res.json({ ok: false, error: "You can only delete your own messages." });
  msg.content = "[deleted]";
  msg.deleted = true;
  saveDb(db);
  emitRefresh("message_delete");
  res.json({ ok: true });
});

app.post("/api/messages/:messageId/react", (req, res) => {
  const db = loadDb();
  const messageId = Number(req.params.messageId);
  const username = String(req.body.username || "");
  const emoji = String(req.body.emoji || "👍");
  const msg = db.messages.find((m) => m.id === messageId);
  if (!msg) return res.json({ ok: false, error: "Message not found." });
  msg.reactions[emoji] ||= [];
  if (msg.reactions[emoji].includes(username)) msg.reactions[emoji] = msg.reactions[emoji].filter((u) => u !== username);
  else msg.reactions[emoji].push(username);
  saveDb(db);
  emitRefresh("reaction");
  res.json({ ok: true });
});

app.post("/api/messages/:messageId/pin", (req, res) => {
  const db = loadDb();
  const messageId = Number(req.params.messageId);
  const msg = db.messages.find((m) => m.id === messageId);
  if (!msg) return res.json({ ok: false, error: "Message not found." });
  msg.pinned = !msg.pinned;
  saveDb(db);
  emitRefresh("pin");
  res.json({ ok: true });
});

app.get("/api/pins", (req, res) => {
  const db = loadDb();
  const scope = String(req.query.scope || "");
  const targetId = Number(req.query.targetId);
  const pins = db.messages.filter((m) => m.scope === scope && m.targetId === targetId && m.pinned && !m.deleted);
  res.json({ ok: true, pins });
});

app.post("/api/notes", (req, res) => {
  const db = loadDb();
  const username = String(req.body.username || "");
  const text = String(req.body.text || "").trim();
  if (!text) return res.json({ ok: false, error: "Note text required." });
  db.notes.push({ id: db.nextNoteId++, username, text, createdAt: now() });
  saveDb(db);
  res.json({ ok: true });
});

app.get("/api/notes", (req, res) => {
  const db = loadDb();
  const username = String(req.query.username || "");
  res.json({ ok: true, notes: db.notes.filter((n) => n.username === username) });
});

app.delete("/api/notes/:noteId", (req, res) => {
  const db = loadDb();
  const noteId = Number(req.params.noteId);
  db.notes = db.notes.filter((n) => n.id !== noteId);
  saveDb(db);
  res.json({ ok: true });
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.json({ ok: false, error: "No file uploaded." });
  const ext = path.extname(req.file.originalname);
  const finalName = `${req.file.filename}${ext}`;
  const oldPath = path.join(UPLOAD_DIR, req.file.filename);
  const finalPath = path.join(UPLOAD_DIR, finalName);
  fs.renameSync(oldPath, finalPath);
  res.json({
    ok: true,
    url: `http://127.0.0.1:${PORT}/uploads/${finalName}`,
    originalName: req.file.originalname,
    mime: req.file.mimetype
  });
});

io.on("connection", (socket) => {
  socket.on("identify", (username) => { socket.username = username; });
  socket.on("typing", (data) => socket.broadcast.emit("typing", data));
  socket.on("call-user", (data) => io.emit("call-user", data));
  socket.on("answer-call", (data) => io.emit("answer-call", data));
  socket.on("ice-candidate", (data) => io.emit("ice-candidate", data));
  socket.on("end-call", (data) => io.emit("end-call", data));
});

server.listen(PORT, () => {
  console.log(`LapChat Plus backend running on http://127.0.0.1:${PORT}`);
});
"""

APP = r"""
import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  Home, Plus, Settings, Hash, Send, UserPlus, Users, Image, Phone, Video,
  Paperclip, Trash2, Edit3, Smile, LogOut, X, Search, Pin, Star, Bell,
  Shield, UserMinus, MessageSquare, Palette, StickyNote, Reply
} from "lucide-react";
import "./style.css";

const API = "http://127.0.0.1:8020";

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, options);
  return res.json();
}
const get = (path) => request(path);
const post = (path, body) => request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const put = (path, body) => request(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const del = (path) => request(path, { method: "DELETE" });

function Avatar({ name, big = false, avatar }) {
  if (avatar) return <img className={big ? "avatar big" : "avatar"} src={avatar} />;
  return <div className={big ? "avatar big" : "avatar"}>{(name || "?")[0].toUpperCase()}</div>;
}

function Modal({ title, children, onClose }) {
  return <div className="modal-backdrop"><div className="modal-card">
    <div className="modal-top"><h2>{title}</h2><button onClick={onClose}><X size={20}/></button></div>{children}
  </div></div>;
}

function App() {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [auth, setAuth] = useState({ username: "", password: "" });
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState(null);
  const [servers, setServers] = useState([]);
  const [channels, setChannels] = useState([]);
  const [members, setMembers] = useState([]);
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [conversationMembers, setConversationMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [pins, setPins] = useState([]);
  const [notes, setNotes] = useState([]);
  const [view, setView] = useState("home");
  const [currentServer, setCurrentServer] = useState(null);
  const [currentChannel, setCurrentChannel] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [typing, setTyping] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const fileRef = useRef(null);
  const socketRef = useRef(null);

  const scope = view === "server" && currentChannel ? "channel" : (view === "dm" || view === "group") && currentConversation ? "conversation" : null;
  const targetId = scope === "channel" ? currentChannel?.id : scope === "conversation" ? currentConversation?.id : null;

  function toast(message) {
    setNotice(message);
    setTimeout(() => setNotice(""), 2600);
  }

  async function refreshAll() {
    if (!user) return;
    const [s, f, r, c, n] = await Promise.all([
      get(`/api/servers?username=${encodeURIComponent(user.username)}`),
      get(`/api/friends?username=${encodeURIComponent(user.username)}`),
      get(`/api/friends/requests?username=${encodeURIComponent(user.username)}`),
      get(`/api/conversations?username=${encodeURIComponent(user.username)}`),
      get(`/api/notes?username=${encodeURIComponent(user.username)}`)
    ]);
    setServers(s.servers || []);
    setFriends(f.friends || []);
    setRequests(r.requests || []);
    setConversations(c.conversations || []);
    setNotes(n.notes || []);
  }

  async function loadMessages(q = search) {
    if (!scope || !targetId) { setMessages([]); setPins([]); return; }
    const data = await get(`/api/messages?scope=${scope}&targetId=${targetId}&q=${encodeURIComponent(q || "")}`);
    const pinData = await get(`/api/pins?scope=${scope}&targetId=${targetId}`);
    setMessages(data.messages || []);
    setPins(pinData.pins || []);
  }

  async function login() {
    const result = await post(authMode === "login" ? "/api/auth/login" : "/api/auth/signup", auth);
    if (!result.ok) return toast(result.error || "Something failed.");
    if (authMode === "signup") { toast("Account created. Switch to login."); setAuthMode("login"); return; }
    setUser(result.user);
  }

  useEffect(() => {
    if (!user) return;
    refreshAll();
    socketRef.current = io(API);
    socketRef.current.emit("identify", user.username);
    socketRef.current.on("refresh", () => { refreshAll(); loadMessages(); });
    socketRef.current.on("typing", (data) => {
      if (data.from !== user.username && data.scope === scope && data.targetId === targetId) {
        setTyping(`${data.from} is typing...`);
        setTimeout(() => setTyping(""), 1700);
      }
    });
    socketRef.current.on("call-user", (data) => { if (data.to === user.username) toast(`${data.from} is calling.`); });
    return () => socketRef.current?.disconnect();
  }, [user, scope, targetId]);

  useEffect(() => { loadMessages(); }, [view, currentChannel?.id, currentConversation?.id]);

  async function openHome() {
    setView("home"); setCurrentServer(null); setCurrentChannel(null); setCurrentConversation(null); setMessages([]); setPins([]); await refreshAll();
  }

  async function openServer(server) {
    setView("server"); setCurrentServer(server); setCurrentConversation(null);
    const ch = await get(`/api/servers/${server.id}/channels`);
    const mem = await get(`/api/servers/${server.id}/members`);
    setChannels(ch.channels || []); setMembers(mem.members || []); setCurrentChannel((ch.channels || [])[0] || null);
  }

  async function selectChannel(channel) { setView("server"); setCurrentChannel(channel); setCurrentConversation(null); }
  async function openConversation(conversation) {
    setCurrentConversation(conversation); setCurrentServer(null); setCurrentChannel(null); setView(conversation.type === "group" ? "group" : "dm");
    if (conversation.type === "group") {
      const mem = await get(`/api/conversations/${conversation.id}/members`);
      setConversationMembers(mem.members || []);
    } else setConversationMembers(conversation.members || []);
  }

  async function sendMessage(type = "text", content = text) {
    if (!scope || !targetId || !content.trim()) return;
    await post("/api/messages", { scope, targetId, sender: user.username, content, type, replyTo: replyTo?.id || null });
    setText(""); setReplyTo(null); await loadMessages("");
  }

  function handleTyping(value) {
    setText(value);
    if (scope && targetId) socketRef.current?.emit("typing", { from: user.username, scope, targetId });
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const form = new FormData(); form.append("file", file);
    const result = await fetch(`${API}/api/upload`, { method: "POST", body: form }).then((r) => r.json());
    if (!result.ok) return toast(result.error);
    let type = "file";
    if (result.mime?.startsWith("image/")) type = "image";
    if (result.mime?.startsWith("video/")) type = "video";
    if (result.mime?.includes("gif")) type = "gif";
    await sendMessage(type, result.url);
    e.target.value = "";
  }

  function openForm(title, fields, submit) { setModal({ title, fields, submit }); }
  const values = (form) => Object.fromEntries(new FormData(form).entries());

  async function editMessage(message) {
    openForm("Edit Message", [{ name: "content", label: "Message", value: message.content }], async (v) => {
      await put(`/api/messages/${message.id}`, { sender: user.username, content: v.content });
      setModal(null); loadMessages();
    });
  }
  async function deleteMessage(message) { await del(`/api/messages/${message.id}?sender=${encodeURIComponent(user.username)}`); await loadMessages(); }
  async function react(message, emoji) { await post(`/api/messages/${message.id}/react`, { username: user.username, emoji }); await loadMessages(); }
  async function pinMessage(message) { await post(`/api/messages/${message.id}/pin`, {}); await loadMessages(); }

  function addFriend() {
    openForm("Add Friend", [{ name: "username", label: "Username" }], async (v) => {
      const result = await post("/api/friends/request", { requester: user.username, receiver: v.username });
      toast(result.ok ? "Friend request sent." : result.error); setModal(null); refreshAll();
    });
  }
  async function acceptFriend(requester) { await post("/api/friends/accept", { username: user.username, requester }); toast("Friend request accepted."); refreshAll(); }
  async function removeFriend(friend) { await del(`/api/friends/${friend}?username=${encodeURIComponent(user.username)}`); toast("Friend removed."); refreshAll(); }
  async function openDm(friend) {
    const name = typeof friend === "string" ? friend : friend.username;
    const result = await post("/api/conversations/dm", { user: user.username, friend: name });
    if (!result.ok) return toast(result.error);
    await refreshAll();
    const data = await get(`/api/conversations?username=${encodeURIComponent(user.username)}`);
    const convo = (data.conversations || []).find((c) => c.id === result.conversationId);
    if (convo) openConversation(convo);
  }

  function createGroup() {
    openForm("Create Group", [{ name: "name", label: "Group name" }, { name: "members", label: "Members, comma separated" }], async (v) => {
      const members = v.members ? v.members.split(",").map((x) => x.trim()).filter(Boolean) : [];
      const result = await post("/api/conversations/group", { owner: user.username, name: v.name, members });
      toast(result.ok ? "Group created." : result.error); setModal(null); refreshAll();
    });
  }

  function addGroupMember() {
    openForm("Add Group Member", [{ name: "username", label: "Username" }], async (v) => {
      const result = await post(`/api/conversations/${currentConversation.id}/members`, { owner: user.username, username: v.username });
      toast(result.ok ? "Member added." : result.error); setModal(null);
      const mem = await get(`/api/conversations/${currentConversation.id}/members`);
      setConversationMembers(mem.members || []);
    });
  }

  function createServer() {
    openForm("Create Server", [{ name: "name", label: "Server name" }], async (v) => {
      const result = await post("/api/servers", { owner: user.username, name: v.name });
      toast(result.ok ? "Server created." : result.error); setModal(null); refreshAll();
    });
  }

  function serverSettings() {
    openForm("Server Settings", [
      { name: "name", label: "Server name", value: currentServer?.name || "" },
      { name: "description", label: "Description", value: currentServer?.description || "" },
      { name: "icon", label: "Icon URL", value: currentServer?.icon || "" }
    ], async (v) => {
      const result = await put(`/api/servers/${currentServer.id}`, { username: user.username, name: v.name, description: v.description, icon: v.icon });
      toast(result.ok ? "Server updated." : result.error); setModal(null);
      if (result.ok) openServer({ ...currentServer, ...result.server });
    });
  }

  function inviteToServer() {
    openForm("Invite User", [{ name: "username", label: "Username" }], async (v) => {
      const result = await post("/api/servers/invite", { serverId: currentServer.id, inviter: user.username, username: v.username });
      toast(result.ok ? "User invited." : result.error); setModal(null);
      const mem = await get(`/api/servers/${currentServer.id}/members`); setMembers(mem.members || []);
    });
  }

  function createChannel() {
    openForm("Create Channel", [{ name: "name", label: "Channel name" }, { name: "topic", label: "Topic" }], async (v) => {
      const result = await post("/api/channels", { serverId: currentServer.id, username: user.username, name: v.name, topic: v.topic });
      toast(result.ok ? "Channel created." : result.error); setModal(null); openServer(currentServer);
    });
  }
  function renameChannel() {
    openForm("Channel Settings", [{ name: "name", label: "Channel name", value: currentChannel.name }, { name: "topic", label: "Topic", value: currentChannel.topic || "" }], async (v) => {
      const result = await put(`/api/channels/${currentChannel.id}`, { name: v.name, topic: v.topic });
      toast(result.ok ? "Channel updated." : result.error); setModal(null); openServer(currentServer);
    });
  }
  async function deleteChannel() { const result = await del(`/api/channels/${currentChannel.id}`); toast(result.ok ? "Channel deleted." : result.error); openServer(currentServer); }

  async function changeRole(member, role) {
    const result = await post(`/api/servers/${currentServer.id}/role`, { actor: user.username, username: member.username, role });
    toast(result.ok ? "Role updated." : result.error);
    const mem = await get(`/api/servers/${currentServer.id}/members`); setMembers(mem.members || []);
  }
  async function kickMember(member) {
    const result = await del(`/api/servers/${currentServer.id}/members/${encodeURIComponent(member.username)}?actor=${encodeURIComponent(user.username)}`);
    toast(result.ok ? "Member removed." : result.error);
    const mem = await get(`/api/servers/${currentServer.id}/members`); setMembers(mem.members || []);
  }

  function settings() {
    openForm("Settings", [
      { name: "username", label: "Username", value: user.username },
      { name: "password", label: "New password", type: "password" },
      { name: "bio", label: "Bio", value: user.bio || "" },
      { name: "customStatus", label: "Custom status", value: user.customStatus || "" },
      { name: "avatar", label: "Avatar URL", value: user.avatar || "" },
      { name: "banner", label: "Banner URL", value: user.banner || "" },
      { name: "accent", label: "Accent color", value: user.accent || "#00d9ff" },
      { name: "theme", label: "Theme: neon, ocean, violet, emerald, mono", value: user.theme || "neon" },
      { name: "density", label: "Density: compact or comfortable", value: user.density || "comfortable" }
    ], async (v) => {
      const result = await post("/api/settings", {
        oldUsername: user.username, newUsername: v.username, newPassword: v.password,
        bio: v.bio, avatar: v.avatar, banner: v.banner, accent: v.accent, theme: v.theme, density: v.density, customStatus: v.customStatus
      });
      if (result.ok) { setUser(result.user); toast("Settings saved."); } else toast(result.error);
      setModal(null); refreshAll();
    });
  }

  function statusModal() {
    openForm("Set Status", [{ name: "status", label: "online, idle, dnd, invisible", value: user.status || "online" }, { name: "customStatus", label: "Custom status", value: user.customStatus || "" }], async (v) => {
      const result = await post("/api/status", { username: user.username, status: v.status, customStatus: v.customStatus });
      if (result.ok) setUser(result.user);
      setModal(null); refreshAll();
    });
  }

  function sendMedia() {
    openForm("Send Media Link", [{ name: "url", label: "GIF / image / video / file URL" }, { name: "type", label: "Type: text, gif, image, video, file", value: "file" }], async (v) => {
      await sendMessage(v.type || "file", v.url); setModal(null);
    });
  }

  function addNote() {
    openForm("Add Personal Note", [{ name: "text", label: "Note" }], async (v) => {
      const result = await post("/api/notes", { username: user.username, text: v.text });
      toast(result.ok ? "Note added." : result.error); setModal(null); refreshAll();
    });
  }
  async function deleteNote(id) { await del(`/api/notes/${id}`); refreshAll(); }

  function callUser(video = false) {
    if (!currentConversation || currentConversation.type !== "dm") return toast("Open a DM first.");
    const other = currentConversation.members.find((m) => m !== user.username);
    socketRef.current?.emit("call-user", { from: user.username, to: other, video });
    toast(video ? "Video call signal sent." : "Voice call signal sent.");
  }

  const currentTitle = () => view === "home" ? "Home" : view === "server" ? (currentChannel ? `# ${currentChannel.name}` : currentServer?.name) : currentConversation?.name || "LapChat";
  const currentSubtitle = () => view === "home" ? "Friends, requests, DMs, groups, and notes" : view === "server" ? (currentChannel?.topic || currentServer?.description || currentServer?.name || "Server") : view === "dm" ? "Direct Message" : "Group Chat";

  if (!user) {
    return <div className="auth-screen">{notice && <div className="toast">{notice}</div>}<div className="auth-card">
      <h1>LapChat+</h1><p>Neon messaging, servers, friends, groups, themes, and customization.</p>
      <input placeholder="Username" value={auth.username} onChange={(e) => setAuth({ ...auth, username: e.target.value })}/>
      <input placeholder="Password" type="password" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })}/>
      <button onClick={login}>{authMode === "login" ? "Login" : "Create Account"}</button>
      <button className="ghost" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}>{authMode === "login" ? "Need an account?" : "Already have an account?"}</button>
    </div></div>;
  }

  return <div className={`app theme-${user.theme || "neon"} density-${user.density || "comfortable"}`} style={{ "--accent": user.accent || "#00d9ff" }}>
    {notice && <div className="toast">{notice}</div>}
    {modal && <Modal title={modal.title} onClose={() => setModal(null)}><form onSubmit={(e) => { e.preventDefault(); modal.submit(values(e.currentTarget)); }}>{modal.fields.map((field) => <label key={field.name}>{field.label}<input name={field.name} type={field.type || "text"} defaultValue={field.value || ""}/></label>)}<button type="submit">Confirm</button></form></Modal>}

    <div className="server-rail">
      <button className={view === "home" ? "server-icon active" : "server-icon"} onClick={openHome}><Home size={24}/></button>
      <div className="rail-divider"/>
      {servers.map((server) => <button key={server.id} className={currentServer?.id === server.id && view === "server" ? "server-icon active" : "server-icon"} onClick={() => openServer(server)} title={server.name}>{server.icon ? <img src={server.icon}/> : server.name.slice(0, 2).toUpperCase()}</button>)}
      <button className="server-icon add" onClick={createServer}><Plus size={24}/></button>
    </div>

    <div className="sidebar">
      {view === "server" ? <>
        <div className="sidebar-title">{currentServer?.name}</div>
        <button className="sidebar-action" onClick={inviteToServer}>Invite User</button>
        <button className="sidebar-action subtle" onClick={serverSettings}><Shield size={16}/> Server Settings</button>
        <div className="section-title">Text Channels</div>
        {channels.map((channel) => <button key={channel.id} className={currentChannel?.id === channel.id ? "channel active" : "channel"} onClick={() => selectChannel(channel)}><Hash size={18}/>{channel.name}</button>)}
        <button className="channel special" onClick={createChannel}><Plus size={18}/> Create Channel</button>
        {currentChannel && <div className="tool-row"><button onClick={renameChannel}>Edit</button><button onClick={deleteChannel}>Delete</button></div>}
      </> : <>
        <div className="sidebar-title">Home</div>
        <button className="sidebar-action" onClick={addFriend}><UserPlus size={16}/> Add Friend</button>
        <button className="sidebar-action" onClick={createGroup}><Users size={16}/> New Group</button>
        <button className="sidebar-action subtle" onClick={addNote}><StickyNote size={16}/> Add Note</button>
        <div className="section-title">Friends</div>
        {friends.length === 0 && <div className="empty">No friends yet.</div>}
        {friends.map((friend) => <div key={friend.username} className="friend-row"><button className="dm-item" onClick={() => openDm(friend)}><Avatar name={friend.username} avatar={friend.avatar}/><span>{friend.username}</span><small>{friend.status}</small></button><button className="mini" onClick={() => removeFriend(friend.username)}><UserMinus size={14}/></button></div>)}
        <div className="section-title">Requests</div>
        {requests.length === 0 && <div className="empty">No pending requests.</div>}
        {requests.map((req) => <div key={req.requester} className="request-card"><span>{req.requester}</span><button onClick={() => acceptFriend(req.requester)}>Accept</button></div>)}
        <div className="section-title">DMs / Groups</div>
        {conversations.map((conversation) => <button key={conversation.id} className={currentConversation?.id === conversation.id ? "dm-item active" : "dm-item"} onClick={() => openConversation(conversation)}><Avatar name={conversation.name}/><span>{conversation.name}</span><small>{conversation.type}</small></button>)}
      </>}
      <div className="sidebar-bottom"><Avatar name={user.username} avatar={user.avatar}/><div><strong>{user.username}</strong><small onClick={statusModal}>{user.customStatus || user.status || "Online"}</small></div><button onClick={settings}><Settings size={18}/></button><button onClick={() => setUser(null)}><LogOut size={18}/></button></div>
    </div>

    <div className="chat-main">
      <div className="topbar"><div><h2>{currentTitle()}</h2><p>{currentSubtitle()}</p></div><div className="top-actions">
        <input className="search" placeholder="Search messages" value={search} onChange={(e) => { setSearch(e.target.value); loadMessages(e.target.value); }}/>
        <button onClick={sendMedia}><Image size={20}/></button><button onClick={() => fileRef.current?.click()}><Paperclip size={20}/></button><button onClick={() => callUser(false)}><Phone size={20}/></button><button onClick={() => callUser(true)}><Video size={20}/></button>
      </div></div>
      {pins.length > 0 && <div className="pinbar"><Pin size={15}/> {pins.length} pinned message{pins.length > 1 ? "s" : ""}: {pins[0].content.slice(0, 90)}</div>}
      <div className="messages">{view === "home" ? <div className="welcome"><h1>Welcome to LapChat+</h1><p>Customize your profile, add friends, create servers, manage roles, pin messages, search chats, and upload media.</p></div> : messages.length === 0 ? <div className="welcome"><h1>No messages yet</h1><p>Start the conversation.</p></div> : messages.map((message) => <div key={message.id} className={message.sender === user.username ? "message mine" : "message"}><Avatar name={message.sender}/><div className="message-bubble">
        {message.replyTo && <div className="reply-preview"><Reply size={13}/> Replying to message #{message.replyTo}</div>}
        <div className="message-meta"><strong>{message.sender}</strong><span>{message.createdAt}</span>{message.edited && !message.deleted && <em>edited</em>}{message.pinned && <Pin size={13}/>}</div>
        {message.deleted ? <p className="deleted">[deleted]</p> : message.type === "gif" || message.type === "image" ? <img className="media-img" src={message.content}/> : message.type === "video" ? <video className="media-video" src={message.content} controls/> : message.type === "file" ? <a href={message.content} target="_blank">Open attachment</a> : <p>{message.content}</p>}
        <div className="reactions">{Object.entries(message.reactions || {}).map(([emoji, users]) => users.length ? <button key={emoji} onClick={() => react(message, emoji)}>{emoji} {users.length}</button> : null)}</div>
        {!message.deleted && <div className="message-actions"><button onClick={() => setReplyTo(message)}><Reply size={14}/> Reply</button><button onClick={() => react(message, "👍")}><Smile size={14}/> 👍</button><button onClick={() => react(message, "🔥")}>🔥</button><button onClick={() => pinMessage(message)}><Pin size={14}/> Pin</button>{message.sender === user.username && <><button onClick={() => editMessage(message)}><Edit3 size={14}/> Edit</button><button onClick={() => deleteMessage(message)}><Trash2 size={14}/> Delete</button></>}</div>}
      </div></div>)}</div>
      {typing && <div className="typing">{typing}</div>}
      {replyTo && <div className="replying">Replying to {replyTo.sender}: {replyTo.content.slice(0, 80)} <button onClick={() => setReplyTo(null)}>cancel</button></div>}
      <div className="composer"><input ref={fileRef} type="file" onChange={uploadFile} hidden/><button disabled={!scope} onClick={() => fileRef.current?.click()}><Paperclip size={20}/></button><input disabled={!scope} placeholder={scope ? "Message..." : "Select a chat first..."} value={text} onChange={(e) => handleTyping(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendMessage(); }}/><button disabled={!scope} onClick={() => sendMessage()}><Send size={20}/></button></div>
    </div>

    <div className="right-panel">
      {view === "server" ? <><h3>Members</h3>{members.map((m) => <div key={m.username} className="member"><Avatar name={m.username} avatar={m.profile?.avatar}/><div><strong>{m.username}</strong><small>{m.role}</small></div>{m.role !== "owner" && <div className="member-actions"><button onClick={() => changeRole(m, m.role === "admin" ? "member" : "admin")}><Shield size={13}/></button><button onClick={() => kickMember(m)}><UserMinus size={13}/></button></div>}</div>)}</> : currentConversation ? <><Avatar name={currentConversation.name} big/><h2>{currentConversation.name}</h2><p>{currentConversation.type}</p>{currentConversation.type === "group" && <><button className="sidebar-action" onClick={addGroupMember}>Add Member</button><h3>Group Members</h3>{conversationMembers.map((m) => <div key={m.username || m} className="member"><Avatar name={m.username || m} avatar={m.avatar}/><strong>{m.username || m}</strong></div>)}</>}</> : <><Avatar name={user.username} avatar={user.avatar} big/><h2>{user.username}</h2><p>{user.bio || "No bio yet."}</p><h3>Notes</h3>{notes.map((n) => <div className="note" key={n.id}>{n.text}<button onClick={() => deleteNote(n.id)}>×</button></div>)}</>}
    </div>
  </div>;
}

export default App;
"""

MAIN = r"""
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./style.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
"""

CSS = r"""
*{box-sizing:border-box}body{margin:0;background:#020617;color:#eaf7ff;font-family:Inter,Segoe UI,Arial,sans-serif}button{border:none;cursor:pointer;font-family:inherit}.auth-screen{min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 20% 20%,rgba(0,217,255,.25),transparent 35%),radial-gradient(circle at 80% 70%,rgba(88,101,242,.25),transparent 35%),#020617}.auth-card{width:440px;background:rgba(5,13,31,.92);border:1px solid rgba(0,217,255,.25);border-radius:24px;padding:36px;box-shadow:0 0 80px rgba(0,217,255,.18)}.auth-card h1{margin:0;font-size:48px;background:linear-gradient(90deg,var(--accent,#00d9ff),#5865f2);-webkit-background-clip:text;color:transparent}.auth-card p{color:#91a9c9;margin-bottom:24px}.auth-card input,.modal-card input{width:100%;background:#071527;color:#eaf7ff;border:1px solid rgba(0,217,255,.25);border-radius:14px;padding:14px;margin-bottom:12px;outline:none}.auth-card button,.modal-card button{width:100%;padding:13px;border-radius:14px;background:linear-gradient(90deg,var(--accent,#00d9ff),#5865f2);color:white;font-weight:800;margin-top:8px}.auth-card .ghost{background:transparent;color:#91a9c9}.toast{position:fixed;top:18px;right:18px;z-index:99;background:#071527;border:1px solid rgba(0,217,255,.35);color:#eaf7ff;padding:14px 18px;border-radius:14px;box-shadow:0 0 30px rgba(0,217,255,.2)}.modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.65);display:grid;place-items:center;z-index:50}.modal-card{width:500px;background:#061225;border:1px solid rgba(0,217,255,.3);border-radius:22px;padding:22px;box-shadow:0 0 70px rgba(0,217,255,.16)}.modal-top{display:flex;justify-content:space-between;align-items:center}.modal-top button{width:38px;height:38px;padding:0;display:grid;place-items:center}.modal-card label{display:block;color:#91a9c9;margin-top:12px}.app{height:100vh;display:grid;grid-template-columns:76px 310px 1fr 280px;background:#020617;overflow:hidden}.theme-ocean{--accent:#00d9ff}.theme-violet{--accent:#a855f7}.theme-emerald{--accent:#00ff9d}.theme-mono{--accent:#e5e7eb}.theme-neon{--accent:#00d9ff}.density-compact .message-bubble{padding:9px}.density-compact .messages{padding:12px}.server-rail{background:#01040d;padding:10px;display:flex;flex-direction:column;gap:10px;align-items:center}.server-icon{width:54px;height:54px;border-radius:27px;background:#071527;color:#eaf7ff;display:grid;place-items:center;font-weight:900;border:1px solid rgba(0,217,255,.12);transition:.18s ease;overflow:hidden}.server-icon img{width:100%;height:100%;object-fit:cover}.server-icon:hover,.server-icon.active{border-radius:18px;background:var(--accent);color:#00111a;box-shadow:0 0 26px rgba(0,217,255,.35)}.server-icon.add{color:#00ff9d}.rail-divider{width:34px;height:2px;background:#12243e;margin:4px 0}.sidebar{background:#061225;border-right:1px solid rgba(0,217,255,.12);padding:16px;display:flex;flex-direction:column;overflow-y:auto}.sidebar-title{font-size:24px;font-weight:900;margin-bottom:12px}.sidebar-action{width:100%;background:linear-gradient(90deg,var(--accent),#5865f2);color:white;border-radius:12px;padding:11px;font-weight:800;margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 0 16px rgba(0,217,255,.2)}.sidebar-action.subtle{background:#071527;color:#eaf7ff}.section-title{color:#91a9c9;font-size:12px;font-weight:900;text-transform:uppercase;margin:18px 0 8px}.channel,.dm-item{width:100%;background:transparent;color:#91a9c9;padding:11px;border-radius:12px;display:flex;gap:9px;align-items:center;text-align:left}.channel:hover,.channel.active,.dm-item:hover,.dm-item.active{background:rgba(0,217,255,.1);color:#eaf7ff}.channel.special{color:#00ff9d}.tool-row{display:flex;gap:8px;margin-top:8px}.tool-row button{flex:1;background:#071527;color:#eaf7ff;padding:8px;border-radius:10px}.empty{color:#91a9c9;font-size:13px;padding:8px}.friend-row{display:flex;align-items:center;gap:6px}.friend-row .dm-item{flex:1}.mini{background:#071527;color:#91a9c9;border-radius:9px;padding:8px}.request-card{background:#071527;padding:10px;border-radius:12px;display:flex;align-items:center;justify-content:space-between}.request-card button{background:#00ff9d;color:#00111a;padding:7px 10px;border-radius:8px}.sidebar-bottom{margin-top:auto;background:#030a16;padding:10px;border-radius:16px;display:flex;gap:9px;align-items:center}.sidebar-bottom small{display:block;color:#00ff9d;cursor:pointer}.sidebar-bottom button{background:transparent;color:#91a9c9}.avatar{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#5865f2);color:white;display:grid;place-items:center;font-weight:900;flex:0 0 auto;object-fit:cover}.avatar.big{width:86px;height:86px;font-size:36px}.chat-main{background:#020617;display:flex;flex-direction:column;min-width:0}.topbar{height:78px;background:#030a16;border-bottom:1px solid rgba(0,217,255,.12);padding:14px 18px;display:flex;justify-content:space-between;align-items:center}.topbar h2{margin:0;font-size:23px}.topbar p{margin:2px 0 0;color:#91a9c9;font-size:13px}.top-actions{display:flex;gap:8px;align-items:center}.top-actions button{width:40px;height:40px;border-radius:12px;background:#071527;color:#91a9c9;display:grid;place-items:center}.top-actions button:hover{color:var(--accent);box-shadow:0 0 18px rgba(0,217,255,.18)}.search{background:#071527;color:#eaf7ff;border:1px solid rgba(0,217,255,.14);border-radius:12px;padding:10px;outline:none}.pinbar,.typing,.replying{background:#071527;border-bottom:1px solid rgba(0,217,255,.12);color:#91a9c9;padding:8px 18px;display:flex;gap:8px;align-items:center}.replying button{background:transparent;color:var(--accent)}.messages{flex:1;overflow-y:auto;padding:22px}.welcome{color:#91a9c9;padding:40px}.welcome h1{color:#eaf7ff}.message{display:flex;gap:12px;margin-bottom:15px}.message.mine{flex-direction:row-reverse}.message-bubble{width:min(760px,85%);background:#061225;border:1px solid rgba(0,217,255,.12);border-radius:16px;padding:14px}.message.mine .message-bubble{background:rgba(0,217,255,.08);border-color:rgba(0,217,255,.25)}.message-meta{display:flex;gap:8px;align-items:center;margin-bottom:6px}.message-meta span,.message-meta em{color:#91a9c9;font-size:12px}.message-bubble p{margin:0;line-height:1.45}.reply-preview{color:#91a9c9;border-left:3px solid var(--accent);padding-left:8px;margin-bottom:8px;font-size:12px}.deleted{color:#91a9c9;font-style:italic}.media-img{max-width:380px;border-radius:14px;display:block}.media-video{max-width:460px;border-radius:14px;display:block}.message-actions{display:flex;gap:6px;margin-top:8px;opacity:0;transition:.15s ease;flex-wrap:wrap}.message-bubble:hover .message-actions{opacity:1}.message-actions button,.reactions button{background:#071527;color:#eaf7ff;border-radius:8px;padding:5px 8px;display:flex;align-items:center;gap:4px}.reactions{display:flex;gap:6px;margin-top:8px}.composer{background:#030a16;border-top:1px solid rgba(0,217,255,.12);padding:14px;display:flex;gap:10px}.composer input{flex:1;background:#071527;color:#eaf7ff;border:1px solid rgba(0,217,255,.14);outline:none;border-radius:14px;padding:14px}.composer button{width:48px;border-radius:14px;background:var(--accent);color:#00111a;display:grid;place-items:center}.composer button:disabled,.composer input:disabled{opacity:.5;cursor:not-allowed}.right-panel{background:#061225;border-left:1px solid rgba(0,217,255,.12);padding:18px;overflow-y:auto}.right-panel h3{color:#91a9c9;text-transform:uppercase;font-size:12px}.right-panel h2{margin-bottom:4px}.right-panel p{color:#91a9c9}.member{display:flex;gap:10px;align-items:center;margin-bottom:10px}.member small{display:block;color:#91a9c9}.member-actions{margin-left:auto;display:flex;gap:4px}.member-actions button{background:#071527;color:#91a9c9;border-radius:8px;padding:7px}.note{background:#071527;border:1px solid rgba(0,217,255,.12);border-radius:12px;padding:10px;margin-bottom:8px;color:#eaf7ff;display:flex;justify-content:space-between;gap:8px}.note button{background:transparent;color:#91a9c9}
"""

def write(path, content):
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    with open(path, "w", encoding="utf-8") as file:
        file.write(content)

def main():
    print("Installing LapChat Plus upgrade...")
    write("server/index.cjs", SERVER)
    write("src/App.jsx", APP)
    write("src/main.jsx", MAIN)
    write("src/style.css", CSS)
    os.makedirs("server/uploads", exist_ok=True)

    if os.path.exists("package.json"):
        with open("package.json", "r", encoding="utf-8") as file:
            package = json.load(file)
    else:
        package = {"name": "lapchat", "version": "2.0.0", "type": "module", "private": True}

    package["scripts"] = {
        "client": "vite --host 127.0.0.1 --port 8570",
        "server": "nodemon server/index.cjs",
        "dev:full": "concurrently \"npm run server\" \"npm run client\"",
        "dev": "vite --host 127.0.0.1 --port 8570",
        "build": "vite build",
        "preview": "vite preview"
    }
    package.setdefault("dependencies", {})
    for dep in ["@vitejs/plugin-react", "vite", "react", "react-dom", "express", "socket.io", "socket.io-client", "cors", "multer", "bcryptjs", "lucide-react"]:
        package["dependencies"][dep] = "latest"
    package.setdefault("devDependencies", {})
    package["devDependencies"]["nodemon"] = "latest"
    package["devDependencies"]["concurrently"] = "latest"

    with open("package.json", "w", encoding="utf-8") as file:
        json.dump(package, file, indent=2)

    print("Done.")
    print()
    print("Now run:")
    print("npm install")
    print("npm run dev:full")

if __name__ == "__main__":
    main()
