const express = require("express");
const http = require("http");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 10000;
const JWT_SECRET =
  process.env.JWT_SECRET || "mullisa-jm-change-this-secret";

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

let pool = null;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    family: 4
  });

  pool.on("error", err => {
    console.error("PostgreSQL error:", err.message);
  });
}

async function db(query, params = []) {
  if (!pool) {
    throw new Error("DATABASE_URL hin argamne.");
  }
  return pool.query(query, params);
}

async function migrate() {
  if (!pool) {
    console.log("DATABASE_URL hin jiru. Database migrations hin raawwatamne.");
    return;
  }

  await db(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      username VARCHAR(80) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      avatar TEXT,
      bio TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS clubs (
      id SERIAL PRIMARY KEY,
      club_code VARCHAR(20) UNIQUE NOT NULL,
      name VARCHAR(150) NOT NULL,
      owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      locked BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS club_members (
      id SERIAL PRIMARY KEY,
      club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(30) DEFAULT 'listener',
      mic_on BOOLEAN DEFAULT FALSE,
      raised_hand BOOLEAN DEFAULT FALSE,
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(club_id, user_id)
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS club_messages (
      id SERIAL PRIMARY KEY,
      club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("Database migrations completed.");
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Login godhi."
    });
  }

  try {
    req.user = jwt.verify(
      header.substring(7),
      JWT_SECRET
    );

    next();
  } catch {
    return res.status(401).json({
      error: "Token sirrii miti."
    });
  }
}

function makeToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      name: user.name
    },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function randomCode() {
  return Math.random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase();
}

/* HEALTH */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    app: "Mullisa-JM",
    database: !!pool,
    time: new Date().toISOString()
  });
});

/* REGISTER */

app.post("/api/register", async (req, res) => {
  try {
    const { name, username, password } = req.body;

    if (!name || !username || !password) {
      return res.status(400).json({
        error: "Maqaa, username fi password guuti."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "Password yoo xiqqaate qubee 6 qabaachuu qaba."
      });
    }

    const exists = await db(
      "SELECT id FROM users WHERE LOWER(username)=LOWER($1)",
      [username]
    );

    if (exists.rows.length) {
      return res.status(409).json({
        error: "Username kun duraan jira."
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const result = await db(
      `INSERT INTO users
       (name, username, password_hash)
       VALUES ($1,$2,$3)
       RETURNING id,name,username,avatar,bio`,
      [name, username, hash]
    );

    const user = result.rows[0];

    res.json({
      ok: true,
      token: makeToken(user),
      user
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Register irratti rakkoon uumame."
    });
  }
});

/* LOGIN */

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await db(
      `SELECT * FROM users
       WHERE LOWER(username)=LOWER($1)`,
      [username]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        error: "Username ykn password dogongora."
      });
    }

    const user = result.rows[0];

    const valid = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        error: "Username ykn password dogongora."
      });
    }

    await db(
      "UPDATE users SET last_seen=CURRENT_TIMESTAMP WHERE id=$1",
      [user.id]
    );

    res.json({
      ok: true,
      token: makeToken(user),
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        avatar: user.avatar,
        bio: user.bio
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Login irratti rakkoon uumame."
    });
  }
});

/* ME */

app.get("/api/me", auth, async (req, res) => {
  try {
    const result = await db(
      `SELECT id,name,username,avatar,bio,last_seen
       FROM users WHERE id=$1`,
      [req.user.id]
    );

    res.json(result.rows[0]);
  } catch {
    res.status(500).json({
      error: "Profile argachuu hin dandeenye."
    });
  }
});

/* USERS / SEARCH */

app.get("/api/users", auth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();

    const result = await db(
      `SELECT id,name,username,avatar,last_seen
       FROM users
       WHERE id <> $1
       AND (
         name ILIKE $2 OR
         username ILIKE $2
       )
       ORDER BY name
       LIMIT 30`,
      [req.user.id, `%${q}%`]
    );

    res.json(result.rows);
  } catch {
    res.status(500).json([]);
  }
});

/* PRIVATE CHAT HISTORY */

app.get("/api/messages/:userId", auth, async (req, res) => {
  try {
    const other = Number(req.params.userId);

    const result = await db(
      `SELECT
        m.id,
        m.sender_id,
        m.receiver_id,
        m.message,
        m.created_at,
        u.name AS sender_name
       FROM messages m
       JOIN users u ON u.id=m.sender_id
       WHERE
       (m.sender_id=$1 AND m.receiver_id=$2)
       OR
       (m.sender_id=$2 AND m.receiver_id=$1)
       ORDER BY m.created_at ASC
       LIMIT 200`,
      [req.user.id, other]
    );

    res.json(result.rows);
  } catch {
    res.status(500).json([]);
  }
});

/* CREATE CLUB */

app.post("/api/clubs", auth, async (req, res) => {
  try {
    const name =
      String(req.body.name || "Mullisa Club").trim();

    let code;

    while (true) {
      code = randomCode();

      const check = await db(
        "SELECT id FROM clubs WHERE club_code=$1",
        [code]
      );

      if (!check.rows.length) break;
    }

    const result = await db(
      `INSERT INTO clubs
       (club_code,name,owner_id)
       VALUES ($1,$2,$3)
       RETURNING *`,
      [code, name, req.user.id]
    );

    await db(
      `INSERT INTO club_members
       (club_id,user_id,role,mic_on)
       VALUES ($1,$2,'host',true)
       ON CONFLICT DO NOTHING`,
      [result.rows[0].id, req.user.id]
    );

    res.json({
      ok: true,
      club: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Club uumuu hin dandeenye."
    });
  }
});

/* JOIN CLUB */

app.post("/api/clubs/join", auth, async (req, res) => {
  try {
    const code =
      String(req.body.code || "")
        .trim()
        .toUpperCase();

    const result = await db(
      "SELECT * FROM clubs WHERE club_code=$1",
      [code]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Club hin argamne."
      });
    }

    const club = result.rows[0];

    if (club.locked && club.owner_id !== req.user.id) {
      return res.status(403).json({
        error: "Club cufameera."
      });
    }

    const count = await db(
      "SELECT COUNT(*) FROM club_members WHERE club_id=$1",
      [club.id]
    );

    if (
      Number(count.rows[0].count) >= 50 &&
      club.owner_id !== req.user.id
    ) {
      return res.status(400).json({
        error: "Club guuteera."
      });
    }

    const role =
      club.owner_id === req.user.id
        ? "host"
        : "listener";

    await db(
      `INSERT INTO club_members
       (club_id,user_id,role)
       VALUES ($1,$2,$3)
       ON CONFLICT(club_id,user_id)
       DO NOTHING`,
      [club.id, req.user.id, role]
    );

    res.json({
      ok: true,
      club
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Club seenuu hin dandeenye."
    });
  }
});

/* CLUB MEMBERS */

app.get("/api/clubs/:code/members", auth, async (req, res) => {
  try {
    const result = await db(
      `SELECT
        cm.user_id,
        cm.role,
        cm.mic_on,
        cm.raised_hand,
        u.name,
        u.username,
        u.avatar
       FROM club_members cm
       JOIN clubs c ON c.id=cm.club_id
       JOIN users u ON u.id=cm.user_id
       WHERE c.club_code=$1
       ORDER BY cm.joined_at`,
      [req.params.code.toUpperCase()]
    );

    res.json(result.rows);
  } catch {
    res.status(500).json([]);
  }
});

/* CLUB CHAT */

app.get("/api/clubs/:code/messages", auth, async (req, res) => {
  try {
    const result = await db(
      `SELECT
        cm.id,
        cm.message,
        cm.created_at,
        u.id AS user_id,
        u.name,
        u.username
       FROM club_messages cm
       JOIN clubs c ON c.id=cm.club_id
       JOIN users u ON u.id=cm.user_id
       WHERE c.club_code=$1
       ORDER BY cm.created_at ASC
       LIMIT 200`,
      [req.params.code.toUpperCase()]
    );

    res.json(result.rows);
  } catch {
    res.status(500).json([]);
  }
});

/* SOCKET.IO */

const onlineUsers = new Map();

io.on("connection", socket => {
  console.log("Socket connected:", socket.id);

  socket.on("user-online", userId => {
    if (!userId) return;

    onlineUsers.set(Number(userId), socket.id);

    socket.userId = Number(userId);

    io.emit("user-status", {
      userId: Number(userId),
      online: true
    });
  });

  /* PRIVATE CHAT */

  socket.on("private-message", async data => {
    try {
      if (!socket.userId) return;

      const receiverId = Number(data.receiverId);
      const message = String(data.message || "").trim();

      if (!receiverId || !message) return;

      const result = await db(
        `INSERT INTO messages
         (sender_id,receiver_id,message)
         VALUES ($1,$2,$3)
         RETURNING id,sender_id,receiver_id,message,created_at`,
        [socket.userId, receiverId, message]
      );

      const payload = {
        ...result.rows[0],
        senderName: data.senderName || "User"
      };

      socket.emit("private-message", payload);

      const target = onlineUsers.get(receiverId);

      if (target) {
        io.to(target).emit("private-message", payload);
      }
    } catch (err) {
      console.error("message error:", err.message);
    }
  });

  /* VOICE / VIDEO CALL SIGNALING */

  socket.on("call-user", data => {
    const target = onlineUsers.get(Number(data.userId));

    if (!target) {
      socket.emit("call-error", {
        message: "Namni kun online miti."
      });
      return;
    }

    io.to(target).emit("incoming-call", {
      fromUserId: socket.userId,
      fromName: data.fromName,
      callType: data.callType,
      offer: data.offer
    });
  });

  socket.on("answer-call", data => {
    const target = onlineUsers.get(Number(data.toUserId));

    if (target) {
      io.to(target).emit("call-answered", {
        fromUserId: socket.userId,
        answer: data.answer
      });
    }
  });

  socket.on("ice-candidate", data => {
    const target = onlineUsers.get(Number(data.toUserId));

    if (target) {
      io.to(target).emit("ice-candidate", {
        fromUserId: socket.userId,
        candidate: data.candidate
      });
    }
  });

  socket.on("end-call", data => {
    const target = onlineUsers.get(Number(data.toUserId));

    if (target) {
      io.to(target).emit("call-ended");
    }
  });

  /* CLUB */

  socket.on("join-club-room", code => {
    socket.join(`club:${String(code).toUpperCase()}`);
  });

  socket.on("club-message", async data => {
    try {
      if (!socket.userId) return;

      const code = String(data.code || "").toUpperCase();
      const message = String(data.message || "").trim();

      if (!code || !message) return;

      const club = await db(
        "SELECT id FROM clubs WHERE club_code=$1",
        [code]
      );

      if (!club.rows.length) return;

      const result = await db(
        `INSERT INTO club_messages
         (club_id,user_id,message)
         VALUES ($1,$2,$3)
         RETURNING id,message,created_at`,
        [club.rows[0].id, socket.userId, message]
      );

      const user = await db(
        "SELECT name,username FROM users WHERE id=$1",
        [socket.userId]
      );

      io.to(`club:${code}`).emit("club-message", {
        ...result.rows[0],
        userId: socket.userId,
        name: user.rows[0]?.name || "User",
        username: user.rows[0]?.username || ""
      });
    } catch (err) {
      console.error("club message:", err.message);
    }
  });

  socket.on("club-voice-signal", data => {
    socket.to(`club:${String(data.code).toUpperCase()}`)
      .emit("club-voice-signal", {
        fromUserId: socket.userId,
        signal: data.signal
      });
  });

  socket.on("club-action", data => {
    socket.to(`club:${String(data.code).toUpperCase()}`)
      .emit("club-action", {
        ...data,
        fromUserId: socket.userId
      });
  });

  socket.on("disconnect", () => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);

      io.emit("user-status", {
        userId: socket.userId,
        online: false
      });
    }

    console.log("Socket disconnected:", socket.id);
  });
});

/* FRONTEND */

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

/* START */

async function start() {
  try {
    await migrate();

    server.listen(PORT, "0.0.0.0", () => {
      console.log(
        `Mullisa-JM running on port ${PORT}`
      );
    });
  } catch (err) {
    console.error("Startup error:", err);
    process.exit(1);
  }
}

start();
