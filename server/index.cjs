
let users = [];
const express = require("express");
const http = require("http");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const { Pool } = require("pg");
const { Server } = require("socket.io");
const path = require("path");
const DB_PATH = path.join(__dirname, "db.json");

function loadDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 8020;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.warn("WARNING: DATABASE_URL is missing. Add it in Render environment variables.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "50mb" }));

const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOAD_DIR));

function id() {
  return Date.now().toString() + Math.random().toString(36).slice(2);
}

function cleanUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    status: user.status || "online",
    customStatus: user.custom_status || user.customStatus || "",
    bio: user.bio || "",
    avatar: user.avatar || "",
    banner: user.banner || "",
    accent: user.accent || "#00d9ff",
    theme: user.theme || "neon",
    density: user.density || "comfortable"
  };
}

function emitRefresh() {
  io.emit("refresh");
}

async function initDB() {
  await pool.query(`
    create table if not exists users (
      id text primary key,
      username text unique not null,
      password text not null,
      status text default 'online',
      custom_status text default '',
      bio text default '',
      avatar text default '',
      banner text default '',
      accent text default '#00d9ff',
      theme text default 'neon',
      density text default 'comfortable',
      created_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists friends (
      id text primary key,
      a text not null,
      b text not null,
      created_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists friend_requests (
      id text primary key,
      requester text not null,
      receiver text not null,
      created_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists servers (
      id text primary key,
      owner text not null,
      name text not null,
      description text default '',
      icon text default '',
      created_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists channels (
      id text primary key,
      server_id text not null,
      name text not null,
      topic text default '',
      created_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists server_members (
      id text primary key,
      server_id text not null,
      username text not null,
      role text default 'member',
      created_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists conversations (
      id text primary key,
      type text not null,
      name text not null,
      owner text default '',
      members jsonb default '[]'::jsonb,
      created_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists messages (
      id text primary key,
      scope text not null,
      target_id text not null,
      sender text not null,
      content text default '',
      type text default 'text',
      reply_to text default null,
      reactions jsonb default '{}'::jsonb,
      pinned boolean default false,
      deleted boolean default false,
      edited boolean default false,
      created_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists notes (
      id text primary key,
      username text not null,
      text text default '',
      created_at timestamptz default now()
    );
  `);

  console.log("Supabase/Postgres tables ready.");
}

app.get("/", (req, res) => {
  res.json({ ok: true, message: "LapChat+ Supabase backend is running" });
});

/* AUTH */

app.post("/api/auth/signup", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      return res.status(400).json({ ok: false, error: "Missing username or password" });
    }

const db = loadDB();

const existingUser = db.users.find(
  u => u.username.toLowerCase() === username.toLowerCase()
);

if (existingUser) {
  return res.status(400).json({
    ok: false,
    error: "Username already exists"
  });
}

    const userId = id();

    const result = await pool.query(
      `insert into users (id, username, password)
       values ($1, $2, $3)
       returning *`,
      [userId, username, password]
    );

    return res.json({ ok: true, user: cleanUser(result.rows[0]) });
  } catch (err) {
    console.error("signup error:", err);
    return res.status(500).json({ ok: false, error: "Signup failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      return res.status(400).json({
        ok: false,
        error: "Missing username or password"
      });
    }

    const user = users.find(
      u =>
        u.username.toLowerCase() === username.toLowerCase() &&
        u.password === password
    );

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "Invalid username or password"
      });
    }

    return res.json({
      ok: true,
      user: cleanUser(user)
    });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({
      ok: false,
      error: "Login failed"
    });
  }
});

/* FRIENDS */

app.get("/api/friends", async (req, res) => {
  try {
    const username = String(req.query.username || "");

    const result = await pool.query(
      `
      select
        case when a=$1 then b else a end as username
      from friends
      where a=$1 or b=$1
      `,
      [username]
    );

    const names = result.rows.map(r => r.username);

    if (!names.length) return res.json({ ok: true, friends: [] });

    const users = await pool.query(
      "select username, status, custom_status, avatar from users where username = any($1::text[])",
      [names]
    );

    const friends = users.rows.map(u => ({
      username: u.username,
      status: u.status || "offline",
      customStatus: u.custom_status || "",
      avatar: u.avatar || ""
    }));

    return res.json({ ok: true, friends });
  } catch (err) {
    console.error("friends error:", err);
    return res.status(500).json({ ok: false, error: "Could not load friends" });
  }
});

app.get("/api/friends/requests", async (req, res) => {
  try {
    const username = String(req.query.username || "");

    const result = await pool.query(
      "select requester, receiver, created_at from friend_requests where receiver=$1 order by created_at desc",
      [username]
    );

    return res.json({ ok: true, requests: result.rows });
  } catch (err) {
    console.error("friend requests error:", err);
    return res.status(500).json({ ok: false, error: "Could not load friend requests" });
  }
});

app.post("/api/friends/request", async (req, res) => {
  try {
    const requester = String(req.body.requester || "").trim();
    const receiver = String(req.body.receiver || "").trim();

    if (!requester || !receiver) {
      return res.status(400).json({ ok: false, error: "Missing username" });
    }

    if (requester.toLowerCase() === receiver.toLowerCase()) {
      return res.status(400).json({ ok: false, error: "You cannot add yourself" });
    }

    const userExists = await pool.query(
      "select id from users where lower(username)=lower($1)",
      [receiver]
    );

    if (!userExists.rows.length) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const alreadyFriends = await pool.query(
      `
      select id from friends
      where (lower(a)=lower($1) and lower(b)=lower($2))
         or (lower(a)=lower($2) and lower(b)=lower($1))
      `,
      [requester, receiver]
    );

    if (alreadyFriends.rows.length) {
      return res.status(400).json({ ok: false, error: "Already friends" });
    }

    const alreadyRequested = await pool.query(
      "select id from friend_requests where lower(requester)=lower($1) and lower(receiver)=lower($2)",
      [requester, receiver]
    );

    if (!alreadyRequested.rows.length) {
      await pool.query(
        "insert into friend_requests (id, requester, receiver) values ($1, $2, $3)",
        [id(), requester, receiver]
      );
    }

    emitRefresh();
    return res.json({ ok: true });
  } catch (err) {
    console.error("friend request error:", err);
    return res.status(500).json({ ok: false, error: "Friend request failed" });
  }
});

app.post("/api/friends/accept", async (req, res) => {
  try {
    const username = String(req.body.username || "");
    const requester = String(req.body.requester || "");

    await pool.query(
      "delete from friend_requests where requester=$1 and receiver=$2",
      [requester, username]
    );

    const exists = await pool.query(
      `
      select id from friends
      where (a=$1 and b=$2) or (a=$2 and b=$1)
      `,
      [username, requester]
    );

    if (!exists.rows.length) {
      await pool.query(
        "insert into friends (id, a, b) values ($1, $2, $3)",
        [id(), username, requester]
      );
    }

    emitRefresh();
    return res.json({ ok: true });
  } catch (err) {
    console.error("accept friend error:", err);
    return res.status(500).json({ ok: false, error: "Could not accept friend" });
  }
});

app.delete("/api/friends/:friend", async (req, res) => {
  try {
    const username = String(req.query.username || "");
    const friend = String(req.params.friend || "");

    await pool.query(
      `
      delete from friends
      where (a=$1 and b=$2) or (a=$2 and b=$1)
      `,
      [username, friend]
    );

    emitRefresh();
    return res.json({ ok: true });
  } catch (err) {
    console.error("remove friend error:", err);
    return res.status(500).json({ ok: false, error: "Could not remove friend" });
  }
});

/* CONVERSATIONS */

app.get("/api/conversations", async (req, res) => {
  try {
    const username = String(req.query.username || "");

    const result = await pool.query(
      `
      select *
      from conversations
      where members ? $1
      order by created_at desc
      `,
      [username]
    );

    const conversations = result.rows.map(c => ({
      id: c.id,
      type: c.type,
      name: c.name,
      owner: c.owner,
      members: c.members || [],
      createdAt: c.created_at
    }));

    return res.json({ ok: true, conversations });
  } catch (err) {
    console.error("conversations error:", err);
    return res.status(500).json({ ok: false, error: "Could not load conversations" });
  }
});

app.post("/api/conversations/dm", async (req, res) => {
  try {
    const user = String(req.body.user || "").trim();
    const friend = String(req.body.friend || "").trim();

    if (!user || !friend) {
      return res.status(400).json({ ok: false, error: "Missing users" });
    }

    const existing = await pool.query(
      `
      select *
      from conversations
      where type='dm'
        and members ? $1
        and members ? $2
      limit 1
      `,
      [user, friend]
    );

    if (existing.rows.length) {
      return res.json({
        ok: true,
        conversationId: existing.rows[0].id,
        conversation: existing.rows[0]
      });
    }

    const convoId = id();
    const name = friend;
    const members = JSON.stringify([user, friend]);

    const created = await pool.query(
      `
      insert into conversations (id, type, name, owner, members)
      values ($1, 'dm', $2, $3, $4::jsonb)
      returning *
      `,
      [convoId, name, user, members]
    );

    emitRefresh();

    return res.json({
      ok: true,
      conversationId: convoId,
      conversation: created.rows[0]
    });
  } catch (err) {
    console.error("dm error:", err);
    return res.status(500).json({ ok: false, error: "Could not open DM" });
  }
});

app.post("/api/conversations/group", async (req, res) => {
  try {
    const owner = String(req.body.owner || req.body.username || "").trim();
    const name = String(req.body.name || "Group").trim();

    let members = req.body.members || [];
    if (typeof members === "string") {
      members = members.split(",").map(x => x.trim()).filter(Boolean);
    }

    if (!owner) {
      return res.status(400).json({ ok: false, error: "Missing owner" });
    }

    const uniqueMembers = [...new Set([owner, ...members])];
    const convoId = id();

    const created = await pool.query(
      `
      insert into conversations (id, type, name, owner, members)
      values ($1, 'group', $2, $3, $4::jsonb)
      returning *
      `,
      [convoId, name, owner, JSON.stringify(uniqueMembers)]
    );

    emitRefresh();

    return res.json({
      ok: true,
      conversationId: convoId,
      conversation: created.rows[0]
    });
  } catch (err) {
    console.error("group error:", err);
    return res.status(500).json({ ok: false, error: "Could not create group" });
  }
});

app.post("/api/groups", async (req, res) => {
  req.url = "/api/conversations/group";
  app._router.handle(req, res);
});

app.get("/api/conversations/:id/members", async (req, res) => {
  try {
    const result = await pool.query("select members from conversations where id=$1", [req.params.id]);
    return res.json({ ok: true, members: result.rows[0]?.members || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Could not load members" });
  }
});

app.post("/api/conversations/:id/members", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();

    const result = await pool.query("select members from conversations where id=$1", [req.params.id]);
    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "Conversation not found" });
    }

    const members = result.rows[0].members || [];
    if (username && !members.includes(username)) members.push(username);

    await pool.query(
      "update conversations set members=$1::jsonb where id=$2",
      [JSON.stringify(members), req.params.id]
    );

    emitRefresh();
    return res.json({ ok: true, members });
  } catch (err) {
    console.error("add group member error:", err);
    return res.status(500).json({ ok: false, error: "Could not add member" });
  }
});

/* SERVERS */

app.get("/api/servers", async (req, res) => {
  try {
    const username = String(req.query.username || "");

    const result = await pool.query(
      `
      select s.*
      from servers s
      join server_members m on m.server_id=s.id
      where m.username=$1
      order by s.created_at desc
      `,
      [username]
    );

    const servers = result.rows.map(s => ({
      id: s.id,
      owner: s.owner,
      name: s.name,
      description: s.description,
      icon: s.icon
    }));

    return res.json({ ok: true, servers });
  } catch (err) {
    console.error("servers error:", err);
    return res.status(500).json({ ok: false, error: "Could not load servers" });
  }
});

app.post("/api/servers", async (req, res) => {
  try {
    const owner = String(req.body.owner || "").trim();
    const name = String(req.body.name || "New Server").trim();

    if (!owner) return res.status(400).json({ ok: false, error: "Missing owner" });

    const serverId = id();
    const channelId = id();

    const serverResult = await pool.query(
      `
      insert into servers (id, owner, name)
      values ($1, $2, $3)
      returning *
      `,
      [serverId, owner, name]
    );

    await pool.query(
      "insert into server_members (id, server_id, username, role) values ($1, $2, $3, 'owner')",
      [id(), serverId, owner]
    );

    await pool.query(
      "insert into channels (id, server_id, name, topic) values ($1, $2, 'general', '')",
      [channelId, serverId]
    );

    emitRefresh();

    return res.json({ ok: true, server: serverResult.rows[0] });
  } catch (err) {
    console.error("create server error:", err);
    return res.status(500).json({ ok: false, error: "Could not create server" });
  }
});

app.get("/api/servers/:id/channels", async (req, res) => {
  try {
    const result = await pool.query(
      "select id, server_id as \"serverId\", name, topic from channels where server_id=$1 order by created_at asc",
      [req.params.id]
    );
    return res.json({ ok: true, channels: result.rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Could not load channels" });
  }
});

app.get("/api/servers/:id/members", async (req, res) => {
  try {
    const result = await pool.query(
      "select username, role from server_members where server_id=$1 order by created_at asc",
      [req.params.id]
    );
    return res.json({ ok: true, members: result.rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Could not load server members" });
  }
});

app.post("/api/servers/invite", async (req, res) => {
  try {
    const serverId = String(req.body.serverId || "");
    const username = String(req.body.username || "").trim();

    if (!serverId || !username) {
      return res.status(400).json({ ok: false, error: "Missing server or username" });
    }

    const userExists = await pool.query(
      "select id from users where lower(username)=lower($1)",
      [username]
    );

    if (!userExists.rows.length) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const exists = await pool.query(
      "select id from server_members where server_id=$1 and username=$2",
      [serverId, username]
    );

    if (!exists.rows.length) {
      await pool.query(
        "insert into server_members (id, server_id, username, role) values ($1, $2, $3, 'member')",
        [id(), serverId, username]
      );
    }

    emitRefresh();
    return res.json({ ok: true });
  } catch (err) {
    console.error("invite error:", err);
    return res.status(500).json({ ok: false, error: "Could not invite user" });
  }
});

app.put("/api/servers/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `
      update servers
      set name=coalesce($1, name),
          description=coalesce($2, description),
          icon=coalesce($3, icon)
      where id=$4
      returning *
      `,
      [req.body.name, req.body.description, req.body.icon, req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "Server not found" });
    }

    emitRefresh();
    return res.json({ ok: true, server: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Could not update server" });
  }
});

app.post("/api/servers/:id/role", async (req, res) => {
  try {
    const result = await pool.query(
      `
      update server_members
      set role=$1
      where server_id=$2 and username=$3
      returning *
      `,
      [req.body.role || "member", req.params.id, req.body.username]
    );

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "Member not found" });
    }

    emitRefresh();
    return res.json({ ok: true, member: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Could not update role" });
  }
});

app.delete("/api/servers/:id/members/:username", async (req, res) => {
  try {
    await pool.query(
      "delete from server_members where server_id=$1 and username=$2",
      [req.params.id, req.params.username]
    );

    emitRefresh();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Could not remove member" });
  }
});

/* CHANNELS */

app.post("/api/channels", async (req, res) => {
  try {
    const channelId = id();

    const result = await pool.query(
      `
      insert into channels (id, server_id, name, topic)
      values ($1, $2, $3, $4)
      returning id, server_id as "serverId", name, topic
      `,
      [channelId, req.body.serverId, req.body.name || "new-channel", req.body.topic || ""]
    );

    emitRefresh();
    return res.json({ ok: true, channel: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Could not create channel" });
  }
});

app.put("/api/channels/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `
      update channels
      set name=coalesce($1, name),
          topic=coalesce($2, topic)
      where id=$3
      returning id, server_id as "serverId", name, topic
      `,
      [req.body.name, req.body.topic, req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "Channel not found" });
    }

    emitRefresh();
    return res.json({ ok: true, channel: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Could not update channel" });
  }
});

app.delete("/api/channels/:id", async (req, res) => {
  try {
    await pool.query("delete from channels where id=$1", [req.params.id]);
    emitRefresh();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Could not delete channel" });
  }
});

/* NOTES */

app.get("/api/notes", async (req, res) => {
  try {
    const username = String(req.query.username || "");

    const result = await pool.query(
      "select id, username, text, created_at as \"createdAt\" from notes where username=$1 order by created_at desc",
      [username]
    );

    return res.json({ ok: true, notes: result.rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Could not load notes" });
  }
});

app.post("/api/notes", async (req, res) => {
  try {
    const noteId = id();

    const result = await pool.query(
      `
      insert into notes (id, username, text)
      values ($1, $2, $3)
      returning id, username, text, created_at as "createdAt"
      `,
      [noteId, req.body.username, req.body.text || ""]
    );

    return res.json({ ok: true, note: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Could not add note" });
  }
});

app.delete("/api/notes/:id", async (req, res) => {
  try {
    await pool.query("delete from notes where id=$1", [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Could not delete note" });
  }
});

/* MESSAGES */

function formatMessage(row) {
  return {
    id: row.id,
    scope: row.scope,
    targetId: row.target_id,
    sender: row.sender,
    content: row.content,
    type: row.type,
    replyTo: row.reply_to,
    reactions: row.reactions || {},
    pinned: row.pinned,
    deleted: row.deleted,
    edited: row.edited,
    createdAt: row.created_at ? new Date(row.created_at).toLocaleString() : ""
  };
}

app.get("/api/messages", async (req, res) => {
  try {
    const scope = String(req.query.scope || "");
    const targetId = String(req.query.targetId || "");
    const q = String(req.query.q || "");

    let result;

    if (q) {
      result = await pool.query(
        `
        select *
        from messages
        where scope=$1 and target_id=$2 and lower(content) like lower($3)
        order by created_at asc
        `,
        [scope, targetId, `%${q}%`]
      );
    } else {
      result = await pool.query(
        `
        select *
        from messages
        where scope=$1 and target_id=$2
        order by created_at asc
        `,
        [scope, targetId]
      );
    }

    return res.json({ ok: true, messages: result.rows.map(formatMessage) });
  } catch (err) {
    console.error("messages error:", err);
    return res.status(500).json({ ok: false, error: "Could not load messages" });
  }
});

app.post("/api/messages", async (req, res) => {
  try {
    const messageId = id();

    const result = await pool.query(
      `
      insert into messages
      (id, scope, target_id, sender, content, type, reply_to)
      values ($1, $2, $3, $4, $5, $6, $7)
      returning *
      `,
      [
        messageId,
        req.body.scope,
        req.body.targetId,
        req.body.sender,
        req.body.content || "",
        req.body.type || "text",
        req.body.replyTo || null
      ]
    );

    emitRefresh();

    return res.json({ ok: true, message: formatMessage(result.rows[0]) });
  } catch (err) {
    console.error("send message error:", err);
    return res.status(500).json({ ok: false, error: "Could not send message" });
  }
});

app.put("/api/messages/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `
      update messages
      set content=$1, edited=true
      where id=$2
      returning *
      `,
      [req.body.content || "", req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "Message not found" });
    }

    emitRefresh();
    return res.json({ ok: true, message: formatMessage(result.rows[0]) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Could not edit message" });
  }
});

app.delete("/api/messages/:id", async (req, res) => {
  try {
    await pool.query(
      "update messages set deleted=true, content='' where id=$1",
      [req.params.id]
    );

    emitRefresh();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Could not delete message" });
  }
});

app.post("/api/messages/:id/react", async (req, res) => {
  try {
    const messageResult = await pool.query("select reactions from messages where id=$1", [req.params.id]);

    if (!messageResult.rows.length) {
      return res.status(404).json({ ok: false, error: "Message not found" });
    }

    const emoji = req.body.emoji || "👍";
    const username = req.body.username;
    const reactions = messageResult.rows[0].reactions || {};

    reactions[emoji] ||= [];

    if (reactions[emoji].includes(username)) {
      reactions[emoji] = reactions[emoji].filter(u => u !== username);
    } else {
      reactions[emoji].push(username);
    }

    await pool.query("update messages set reactions=$1::jsonb where id=$2", [
      JSON.stringify(reactions),
      req.params.id
    ]);

    emitRefresh();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Could not react" });
  }
});

app.post("/api/messages/:id/pin", async (req, res) => {
  try {
    await pool.query("update messages set pinned = not pinned where id=$1", [req.params.id]);
    emitRefresh();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Could not pin message" });
  }
});

app.get("/api/pins", async (req, res) => {
  try {
    const scope = String(req.query.scope || "");
    const targetId = String(req.query.targetId || "");

    const result = await pool.query(
      `
      select *
      from messages
      where scope=$1 and target_id=$2 and pinned=true
      order by created_at desc
      `,
      [scope, targetId]
    );

    return res.json({ ok: true, pins: result.rows.map(formatMessage) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Could not load pins" });
  }
});

/* SETTINGS */

app.post("/api/settings", async (req, res) => {
  try {
    const oldUsername = req.body.oldUsername;
    const newUsername = req.body.newUsername || oldUsername;

    const result = await pool.query(
      `
      update users
      set username=$1,
          password=case when $2='' or $2 is null then password else $2 end,
          bio=$3,
          avatar=$4,
          banner=$5,
          accent=$6,
          theme=$7,
          density=$8,
          custom_status=$9
      where username=$10
      returning *
      `,
      [
        newUsername,
        req.body.newPassword || "",
        req.body.bio || "",
        req.body.avatar || "",
        req.body.banner || "",
        req.body.accent || "#00d9ff",
        req.body.theme || "neon",
        req.body.density || "comfortable",
        req.body.customStatus || "",
        oldUsername
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    emitRefresh();

    return res.json({ ok: true, user: cleanUser(result.rows[0]) });
  } catch (err) {
    console.error("settings error:", err);
    return res.status(500).json({ ok: false, error: "Could not save settings" });
  }
});

app.post("/api/status", async (req, res) => {
  try {
    const result = await pool.query(
      `
      update users
      set status=$1, custom_status=$2
      where username=$3
      returning *
      `,
      [req.body.status || "online", req.body.customStatus || "", req.body.username]
    );

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    emitRefresh();

    return res.json({ ok: true, user: cleanUser(result.rows[0]) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Could not update status" });
  }
});

/* UPLOADS */

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, id() + path.extname(file.originalname))
});

const upload = multer({ storage });

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: "No file uploaded" });
  }

  const base = `${req.protocol}://${req.get("host")}`;

  res.json({
    ok: true,
    url: `${base}/uploads/${req.file.filename}`,
    mime: req.file.mimetype,
    filename: req.file.originalname
  });
});

/* CALL / SOCKET EVENTS */

io.on("connection", socket => {
  socket.on("identify", username => {
    socket.username = username;
    socket.join(username);
  });

  socket.on("typing", data => {
    socket.broadcast.emit("typing", data);
  });

  socket.on("call-user", data => {
    if (data.to) io.to(data.to).emit("call-user", data);
    else socket.broadcast.emit("call-user", data);
  });

  socket.on("call-accepted", data => {
    if (data.to) io.to(data.to).emit("call-accepted", data);
  });

  socket.on("call-declined", data => {
    if (data.to) io.to(data.to).emit("call-declined", data);
  });

  socket.on("call-ended", data => {
    if (data.to) io.to(data.to).emit("call-ended", data);
  });

  socket.on("webrtc-offer", data => {
    if (data.to) io.to(data.to).emit("webrtc-offer", data);
  });

  socket.on("webrtc-answer", data => {
    if (data.to) io.to(data.to).emit("webrtc-answer", data);
  });

  socket.on("webrtc-ice", data => {
    if (data.to) io.to(data.to).emit("webrtc-ice", data);
  });
});

/* 404 */

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Route not found",
    method: req.method,
    path: req.path
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`LapChat+ backend running on port ${PORT}`);
});
