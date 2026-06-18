
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
