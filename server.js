const express = require("express");
const http = require("http");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || "mullisa-jm-change-this-secret";

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

/* =========================
   DATABASE
========================= */

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL hin argamne.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000
});

async function query(text, params = []) {
  return pool.query(text, params);
}

/* =========================
   DATABASE SETUP
========================= */

async function initDatabase() {
  console.log("Database initialization started...");

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      bio TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      status TEXT DEFAULT 'offline',
      last_seen TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS posts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      image_url TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS post_likes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(post_id, user_id)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS post_shares (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(post_id, user_id)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS classes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
      owner_name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS class_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      seat INTEGER,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(class_id, user_id),
      UNIQUE(class_id, seat)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
      owner_name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS room_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      seat INTEGER,
      mic_on BOOLEAN DEFAULT true,
      camera_on BOOLEAN DEFAULT true,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(room_id, user_id),
      UNIQUE(room_id, seat)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
      sender_name TEXT NOT NULL,
      receiver_id UUID REFERENCES users(id) ON DELETE SET NULL,
      room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
      class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS follows (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
      following_id UUID REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(follower_id, following_id)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      is_read BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log("Database migrations completed.");
}

/* =========================
   AUTH
========================= */

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username
    },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Login barbaachisa."
    });
  }

  const token = header.substring(7);

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      error: "Token sirrii miti ykn yeroo isaa darbeera."
    });
  }
}

/* =========================
   HEALTH
========================= */

app.get("/api/health", async (req, res) => {
  try {
    await query("SELECT 1");

    res.json({
      ok: true,
      app: "Mullisa-JM",
      database: "connected",
      time: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      database: "error",
      error: error.message
    });
  }
});

/* =========================
   REGISTER
========================= */

app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: "Maqaa fayyadamaa fi password galchi."
      });
    }

    if (username.length < 3) {
      return res.status(400).json({
        error: "Maqaan yoo xiqqaate qubee 3 qabaachuu qaba."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "Password yoo xiqqaate qubee 6 qabaachuu qaba."
      });
    }

    const exists = await query(
      "SELECT id FROM users WHERE LOWER(username)=LOWER($1)",
      [username.trim()]
    );

    if (exists.rows.length) {
      return res.status(409).json({
        error: "Maqaan kun duraan qabameera."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await query(
      `
      INSERT INTO users(username,password_hash)
      VALUES($1,$2)
      RETURNING id,username,bio,avatar,status,last_seen,created_at
      `,
      [username.trim(), passwordHash]
    );

    const user = result.rows[0];

    res.json({
      ok: true,
      user,
      token: createToken(user)
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Register irratti rakkoon uumame."
    });
  }
});

/* =========================
   LOGIN
========================= */

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: "Username fi password galchi."
      });
    }

    const result = await query(
      "SELECT * FROM users WHERE LOWER(username)=LOWER($1)",
      [username.trim()]
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

    await query(
      `
      UPDATE users
      SET status='online', last_seen=NOW()
      WHERE id=$1
      `,
      [user.id]
    );

    delete user.password_hash;

    res.json({
      ok: true,
      user,
      token: createToken(user)
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Login irratti rakkoon uumame."
    });
  }
});

/* =========================
   ME
========================= */

app.get("/api/me", auth, async (req, res) => {
  const result = await query(
    `
    SELECT id,username,bio,avatar,status,last_seen,created_at
    FROM users
    WHERE id=$1
    `,
    [req.user.id]
  );

  if (!result.rows.length) {
    return res.status(404).json({
      error: "User hin argamne."
    });
  }

  res.json({
    user: result.rows[0]
  });
});

/* =========================
   USERS / SEARCH
========================= */

app.get("/api/users", auth, async (req, res) => {
  const search = String(req.query.search || "").trim();

  const result = await query(
    `
    SELECT id,username,bio,avatar,status,last_seen
    FROM users
    WHERE username ILIKE $1
    ORDER BY username
    LIMIT 50
    `,
    [`%${search}%`]
  );

  res.json({
    users: result.rows
  });
});

/* =========================
   POSTS
========================= */

app.get("/api/posts", async (req, res) => {
  try {
    const result = await query(`
      SELECT
        p.id,
        p.user_id,
        p.username,
        p.content,
        p.image_url,
        p.created_at,
        COUNT(DISTINCT l.id)::int AS likes,
        COUNT(DISTINCT c.id)::int AS comments,
        COUNT(DISTINCT s.id)::int AS shares
      FROM posts p
      LEFT JOIN post_likes l ON l.post_id=p.id
      LEFT JOIN comments c ON c.post_id=p.id
      LEFT JOIN post_shares s ON s.post_id=p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT 100
    `);

    res.json({
      posts: result.rows
    });
  } catch (error) {
    res.status(500).json({
      error: "Posts fidhuun hin danda'amne."
    });
  }
});

app.post("/api/posts", auth, async (req, res) => {
  try {
    const { content, image_url = "" } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({
        error: "Post kee barreessi."
      });
    }

    const result = await query(
      `
      INSERT INTO posts(user_id,username,content,image_url)
      VALUES($1,$2,$3,$4)
      RETURNING *
      `,
      [
        req.user.id,
        req.user.username,
        content.trim(),
        image_url
      ]
    );

    const post = result.rows[0];

    io.emit("newPost", post);

    res.json({
      ok: true,
      post
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Post uumuu irratti rakkoo."
    });
  }
});

/* =========================
   LIKE
========================= */

app.post("/api/posts/:id/like", auth, async (req, res) => {
  try {
    const postId = req.params.id;

    const exists = await query(
      `
      SELECT id
      FROM post_likes
      WHERE post_id=$1 AND user_id=$2
      `,
      [postId, req.user.id]
    );

    let liked;

    if (exists.rows.length) {
      await query(
        `
        DELETE FROM post_likes
        WHERE post_id=$1 AND user_id=$2
        `,
        [postId, req.user.id]
      );

      liked = false;
    } else {
      await query(
        `
        INSERT INTO post_likes(post_id,user_id)
        VALUES($1,$2)
        `,
        [postId, req.user.id]
      );

      liked = true;
    }

    const count = await query(
      `
      SELECT COUNT(*)::int AS count
      FROM post_likes
      WHERE post_id=$1
      `,
      [postId]
    );

    io.emit("postLikeChanged", {
      postId,
      likes: count.rows[0].count
    });

    res.json({
      ok: true,
      liked,
      likes: count.rows[0].count
    });
  } catch (error) {
    res.status(500).json({
      error: "Like irratti rakkoo."
    });
  }
});

/* =========================
   COMMENTS
========================= */

app.get("/api/posts/:id/comments", async (req, res) => {
  const result = await query(
    `
    SELECT id,post_id,user_id,username,content,created_at
    FROM comments
    WHERE post_id=$1
    ORDER BY created_at ASC
    `,
    [req.params.id]
  );

  res.json({
    comments: result.rows
  });
});

app.post("/api/posts/:id/comments", auth, async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({
        error: "Comment barreessi."
      });
    }

    const result = await query(
      `
      INSERT INTO comments(post_id,user_id,username,content)
      VALUES($1,$2,$3,$4)
      RETURNING *
      `,
      [
        req.params.id,
        req.user.id,
        req.user.username,
        content.trim()
      ]
    );

    const comment = result.rows[0];

    io.emit("newComment", comment);

    res.json({
      ok: true,
      comment
    });
  } catch (error) {
    res.status(500).json({
      error: "Comment irratti rakkoo."
    });
  }
});

/* =========================
   SHARE
========================= */

app.post("/api/posts/:id/share", auth, async (req, res) => {
  try {
    await query(
      `
      INSERT INTO post_shares(post_id,user_id)
      VALUES($1,$2)
      ON CONFLICT DO NOTHING
      `,
      [req.params.id, req.user.id]
    );

    const count = await query(
      `
      SELECT COUNT(*)::int AS count
      FROM post_shares
      WHERE post_id=$1
      `,
      [req.params.id]
    );

    res.json({
      ok: true,
      shares: count.rows[0].count
    });
  } catch (error) {
    res.status(500).json({
      error: "Share irratti rakkoo."
    });
  }
});

/* =========================
   CLASSES
========================= */

app.post("/api/classes", auth, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        error: "Maqaa kilaasii galchi."
      });
    }

    const result = await query(
      `
      INSERT INTO classes(name,owner_id,owner_name)
      VALUES($1,$2,$3)
      RETURNING *
      `,
      [
        name.trim(),
        req.user.id,
        req.user.username
      ]
    );

    const classroom = result.rows[0];

    await query(
      `
      INSERT INTO class_members
      (class_id,user_id,username,seat)
      VALUES($1,$2,$3,1)
      `,
      [
        classroom.id,
        req.user.id,
        req.user.username
      ]
    );

    res.json({
      ok: true,
      class: classroom,
      seat: 1
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Kilaasii uumuu hin dandeenye."
    });
  }
});

app.get("/api/classes", async (req, res) => {
  const result = await query(`
    SELECT
      c.id,
      c.name,
      c.owner_id,
      c.owner_name,
      c.created_at,
      COUNT(cm.id)::int AS members
    FROM classes c
    LEFT JOIN class_members cm
      ON cm.class_id=c.id
    GROUP BY c.id
    ORDER BY c.created_at DESC
    LIMIT 100
  `);

  res.json({
    classes: result.rows
  });
});

app.get("/api/classes/:id", async (req, res) => {
  const result = await query(
    `
    SELECT
      c.id,
      c.name,
      c.owner_id,
      c.owner_name,
      c.created_at
    FROM classes c
    WHERE c.id=$1
    `,
    [req.params.id]
  );

  if (!result.rows.length) {
    return res.status(404).json({
      error: "Kilaasii hin argamne."
    });
  }

  const members = await query(
    `
    SELECT
      user_id,
      username,
      seat,
      joined_at
    FROM class_members
    WHERE class_id=$1
    ORDER BY seat NULLS LAST
    `,
    [req.params.id]
  );

  res.json({
    class: result.rows[0],
    members: members.rows
  });
});

/* =========================
   JOIN CLASS
========================= */

app.post("/api/classes/:id/join", auth, async (req, res) => {
  try {
    const classId = req.params.id;

    const classroom = await query(
      "SELECT * FROM classes WHERE id=$1",
      [classId]
    );

    if (!classroom.rows.length) {
      return res.status(404).json({
        error: "Kilaasii hin argamne."
      });
    }

    const existing = await query(
      `
      SELECT *
      FROM class_members
      WHERE class_id=$1 AND user_id=$2
      `,
      [classId, req.user.id]
    );

    if (existing.rows.length) {
      return res.json({
        ok: true,
        seat: existing.rows[0].seat,
        alreadyJoined: true
      });
    }

    const seats = await query(
      `
      SELECT seat
      FROM class_members
      WHERE class_id=$1
      AND seat IS NOT NULL
      ORDER BY seat
      `,
      [classId]
    );

    const occupied = new Set(
      seats.rows.map(x => Number(x.seat))
    );

    let seat = null;

    for (let i = 2; i <= 10; i++) {
      if (!occupied.has(i)) {
        seat = i;
        break;
      }
    }

    await query(
      `
      INSERT INTO class_members
      (class_id,user_id,username,seat)
      VALUES($1,$2,$3,$4)
      `,
      [
        classId,
        req.user.id,
        req.user.username,
        seat
      ]
    );

    res.json({
      ok: true,
      seat,
      audience: seat === null
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Kilaasii seenuu irratti rakkoo."
    });
  }
});

/* =========================
   LEAVE CLASS
========================= */

app.post("/api/classes/:id/leave", auth, async (req, res) => {
  await query(
    `
    DELETE FROM class_members
    WHERE class_id=$1 AND user_id=$2
    `,
    [
      req.params.id,
      req.user.id
    ]
  );

  res.json({
    ok: true
  });
});

/* =========================
   ROOMS
========================= */

app.post("/api/rooms", auth, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        error: "Maqaa room galchi."
      });
    }

    const result = await query(
      `
      INSERT INTO rooms(name,owner_id,owner_name)
      VALUES($1,$2,$3)
      RETURNING *
      `,
      [
        name.trim(),
        req.user.id,
        req.user.username
      ]
    );

    res.json({
      ok: true,
      room: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      error: "Room uumuu hin dandeenye."
    });
  }
});

app.get("/api/rooms", async (req, res) => {
  const result = await query(`
    SELECT
      r.id,
      r.name,
      r.owner_id,
      r.owner_name,
      r.created_at,
      COUNT(rm.id)::int AS members
    FROM rooms r
    LEFT JOIN room_members rm
      ON rm.room_id=r.id
    GROUP BY r.id
    ORDER BY r.created_at DESC
    LIMIT 100
  `);

  res.json({
    rooms: result.rows
  });
});

app.get("/api/rooms/:id", async (req, res) => {
  const result = await query(
    "SELECT * FROM rooms WHERE id=$1",
    [req.params.id]
  );

  if (!result.rows.length) {
    return res.status(404).json({
      error: "Room hin argamne."
    });
  }

  const members = await query(
    `
    SELECT
      user_id,
      username,
      seat,
      mic_on,
      camera_on
    FROM room_members
    WHERE room_id=$1
    ORDER BY seat NULLS LAST
    `,
    [req.params.id]
  );

  res.json({
    room: result.rows[0],
    members: members.rows
  });
});

/* =========================
   JOIN ROOM
========================= */

app.post("/api/rooms/:id/join", auth, async (req, res) => {
  try {
    const roomId = req.params.id;

    const room = await query(
      "SELECT * FROM rooms WHERE id=$1",
      [roomId]
    );

    if (!room.rows.length) {
      return res.status(404).json({
        error: "Room hin argamne."
      });
    }

    const existing = await query(
      `
      SELECT *
      FROM room_members
      WHERE room_id=$1 AND user_id=$2
      `,
      [roomId, req.user.id]
    );

    if (existing.rows.length) {
      return res.json({
        ok: true,
        seat: existing.rows[0].seat,
        alreadyJoined: true
      });
    }

    const seats = await query(
      `
      SELECT seat
      FROM room_members
      WHERE room_id=$1
      AND seat IS NOT NULL
      ORDER BY seat
      `,
      [roomId]
    );

    const occupied = new Set(
      seats.rows.map(x => Number(x.seat)
    ));

    let seat = null;

    for (let i = 1; i <= 10; i++) {
      if (!occupied.has(i)) {
        seat = i;
        break;
      }
    }

    await query(
      `
      INSERT INTO room_members
      (room_id,user_id,username,seat)
      VALUES($1,$2,$3,$4)
      `,
      [
        roomId,
        req.user.id,
        req.user.username,
        seat
      ]
    );

    res.json({
      ok: true,
      seat,
      audience: seat === null
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Room seenuu irratti rakkoo."
    });
  }
});

/* =========================
   LEAVE ROOM
========================= */

app.post("/api/rooms/:id/leave", auth, async (req, res) => {
  await query(
    `
    DELETE FROM room_members
    WHERE room_id=$1 AND user_id=$2
    `,
    [
      req.params.id,
      req.user.id
    ]
  );

  res.json({
    ok: true
  });
});

/* =========================
   SOCKET.IO
========================= */

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const onlineUsers = new Map();

io.on("connection", socket => {
  console.log("Socket connected:", socket.id);

  socket.on("userOnline", async data => {
    if (!data?.userId) return;

    onlineUsers.set(String(data.userId), socket.id);

    try {
      await query(
        `
        UPDATE users
        SET status='online', last_seen=NOW()
        WHERE id=$1
        `,
        [data.userId]
      );

      io.emit("userStatus", {
        userId: data.userId,
        status: "online"
      });
    } catch {}
  });

  /* CLASS */

  socket.on("joinClass", async data => {
    if (!data?.classId) return;

    socket.join(`class:${data.classId}`);

    socket.classId = data.classId;

    io.to(`class:${data.classId}`).emit(
      "classUserJoined",
      {
        userId: data.userId,
        username: data.username
      }
    );
  });

  socket.on("classMessage", async data => {
    if (!data?.classId || !data?.content) return;

    const message = {
      id: Date.now().toString(),
      classId: data.classId,
      userId: data.userId,
      username: data.username,
      content: data.content,
      createdAt: new Date().toISOString()
    };

    try {
      await query(
        `
        INSERT INTO messages
        (sender_id,sender_name,class_id,content)
        VALUES($1,$2,$3,$4)
        `,
        [
          data.userId,
          data.username,
          data.classId,
          data.content
        ]
      );
    } catch {}

    io.to(`class:${data.classId}`).emit(
      "classMessage",
      message
    );
  });

  /* ROOM */

  socket.on("joinRoom", data => {
    if (!data?.roomId) return;

    socket.join(`room:${data.roomId}`);

    socket.roomId = data.roomId;

    io.to(`room:${data.roomId}`).emit(
      "roomUserJoined",
      {
        socketId: socket.id,
        userId: data.userId,
        username: data.username,
        seat: data.seat
      }
    );
  });

  socket.on("leaveRoom", data => {
    if (!data?.roomId) return;

    socket.leave(`room:${data.roomId}`);

    socket.to(`room:${data.roomId}`).emit(
      "roomUserLeft",
      {
        socketId: socket.id,
        userId: data.userId
      }
    );
  });

  /* PRIVATE MESSAGE */

  socket.on("privateMessage", async data => {
    if (!data?.to || !data?.content) return;

    const targetSocket = onlineUsers.get(
      String(data.to)
    );

    if (targetSocket) {
      io.to(targetSocket).emit(
        "privateMessage",
        data
      );
    }

    try {
      await query(
        `
        INSERT INTO messages
        (sender_id,sender_name,receiver_id,content)
        VALUES($1,$2,$3,$4)
        `,
        [
          data.userId,
          data.username,
          data.to,
          data.content
        ]
      );
    } catch {}
  });

  /* WEBRTC */

  socket.on("offer", data => {
    if (data?.to) {
      io.to(data.to).emit("offer", {
        from: socket.id,
        offer: data.offer
      });
    }
  });

  socket.on("answer", data => {
    if (data?.to) {
      io.to(data.to).emit("answer", {
        from: socket.id,
        answer: data.answer
      });
    }
  });

  socket.on("ice-candidate", data => {
    if (data?.to) {
      io.to(data.to).emit("ice-candidate", {
        from: socket.id,
        candidate: data.candidate
      });
    }
  });

  /* MIC */

  socket.on("micStatus", data => {
    if (!data?.roomId) return;

    socket.to(`room:${data.roomId}`).emit(
      "micStatus",
      {
        userId: data.userId,
        micOn: data.micOn
      }
    );
  });

  /* CAMERA */

  socket.on("cameraStatus", data => {
    if (!data?.roomId) return;

    socket.to(`room:${data.roomId}`).emit(
      "cameraStatus",
      {
        userId: data.userId,
        cameraOn: data.cameraOn
      }
    );
  });

  /* DISCONNECT */

  socket.on("disconnect", async () => {
    console.log("Socket disconnected:", socket.id);

    for (const [userId, socketId] of onlineUsers.entries()) {
      if (socketId === socket.id) {
        onlineUsers.delete(userId);

        try {
          await query(
            `
            UPDATE users
            SET status='offline', last_seen=NOW()
            WHERE id=$1
            `,
            [userId]
          );

          io.emit("userStatus", {
            userId,
            status: "offline"
          });
        } catch {}

        break;
      }
    }

    if (socket.roomId) {
      socket.to(`room:${socket.roomId}`).emit(
        "roomUserLeft",
        {
          socketId: socket.id
        }
      );
    }
  });
});

/* =========================
   FRONTEND
========================= */

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

/* =========================
   START
========================= */

async function start() {
  try {
    await initDatabase();

    server.listen(PORT, "0.0.0.0", () => {
      console.log(
        `Mullisa-JM server running on port ${PORT}`
      );
    });
  } catch (error) {
    console.error(
      "Server/database error:",
      error
    );

    process.exit(1);
  }
}

start();
