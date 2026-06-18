const express = require("express");
const http = require("http");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const { Server } = require("socket.io");
const path = require("path");
const { Pool } = require("pg"); // Added missing PostgreSQL connection import

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 8020;
const DB_PATH = path.join(__dirname, "db.json");

// Added missing pool definition using Environment Variables
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Render to connect securely to Supabase/Postgres
  }
});

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    return {
      users: [], friends: [], friend_requests: [], servers: [],
      channels: [], server_members: [], conversations: [],
      messages: [], notes: []
    };
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

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
  try {
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
  } catch (error) {
    console.error("Failed to initialize database tables:", error);
  }
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

    const existingUser = await pool.query(
      "SELECT id FROM users WHERE LOWER(username)=LOWER($1)",
      [username]
    );

    if (existingUser.rows.length) {
      return res.status(400).json({
        ok: false,
        error: "Username already exists"
      });
    }

    const userId = id();

    const result = await pool.query(
      `INSERT INTO users
       (id, username, password, status, custom_status, bio, avatar, banner, accent, theme, density)
       VALUES
       ($1,$2,$3,'online','','','','','#00d9ff','neon','comfortable')
       RETURNING *`,
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

    const result = await pool.query(
      `SELECT *
       FROM users
       WHERE LOWER(username)=LOWER($1)
       AND password=$2`,
      [username, password]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        ok: false,
        error: "Invalid username or password"
      });
    }

    return res.json({
      ok: true,
      user: cleanUser(result.rows[0])
    });

  } catch (err) {
    console.error("login error:", err);

    return res.status(500).json({
      ok: false,
      error: "Login failed"
    });
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

    if (alreadyRequested.rows.length) {
      return res.status(400).json({ ok: false, error: "Already requested" });
    }

    const requestId = id();
    await pool.query(
      "insert into friend_requests (id, requester, receiver) values ($1, $2, $3)",
      [requestId, requester, receiver]
    );

    emitRefresh();
    return res.json({ ok: true });
  } catch (err) {
    console.error("friend request sending error:", err);
    return res.status(500).json({ ok: false, error: "Could not send friend request" });
  }
});

// Initialize database tables and start up the server
server.listen(PORT, async () => {
  await initDB();
  console.log(`Server running on port ${PORT}`);
});
