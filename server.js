const express = require("express");
const http = require("http");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 10000;
const JWT_SECRET =
  process.env.JWT_SECRET || "mullisa-jm-change-this-secret";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL hin argamne.");
  process.exit(1);
}

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   DATABASE
========================================================= */

const pool = new Pool({
  connectionString: DATABASE_URL,

  ssl: {
    rejectUnauthorized: false
  },

  family: 4,

  connectionTimeoutMillis: 15000,

  idleTimeoutMillis: 30000,

  max: 10
});

async function query(text, params = []) {
  return pool.query(text, params);
}

/* =========================================================
   DATABASE TEST
========================================================= */

async function testDatabase() {
  let lastError = null;

  for (let i = 1; i <= 5; i++) {
    try {
      await query("SELECT NOW()");
      console.log("✅ Database connected.");
      return true;
    } catch (error) {
      lastError = error;

      console.log(
        `⚠️ Database connection attempt ${i}/5 failed`
      );

      console.log(error.message);

      await new Promise((resolve) =>
        setTimeout(resolve, 3000)
      );
    }
  }

  throw lastError;
}

/* =========================================================
   DATABASE MIGRATION
   IMPORTANT:
   NO DROP TABLE HERE
========================================================= */

async function initDatabase() {
  console.log("🔄 Database migration started...");

  /* UUID */
  await query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto
  `);

  /* =====================================================
     USERS
  ===================================================== */

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
    )
  `);

  /* =====================================================
     POSTS
  ===================================================== */

  await query(`
    CREATE TABLE IF NOT EXISTS posts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      username TEXT,
      content TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  /* =====================================================
     POST LIKES
  ===================================================== */

  await query(`
    CREATE TABLE IF NOT EXISTS post_likes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(post_id, user_id)
    )
  `);

  /* =====================================================
     COMMENTS
  ===================================================== */

  await query(`
    CREATE TABLE IF NOT EXISTS comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      username TEXT,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  /* =====================================================
     SHARES
  ===================================================== */

  await query(`
    CREATE TABLE IF NOT EXISTS post_shares (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(post_id, user_id)
    )
  `);

  /* =====================================================
     CLASSES
  ===================================================== */

  await query(`
    CREATE TABLE IF NOT EXISTS classes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
      owner_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  /* =====================================================
     CLASS MEMBERS
  ===================================================== */

  await query(`
    CREATE TABLE IF NOT EXISTS class_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      username TEXT,
      seat INTEGER,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(class_id, user_id),
      UNIQUE(class_id, seat)
    )
  `);

  /* =====================================================
     ROOMS / VOICE CLUB
  ===================================================== */

  await query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
      owner_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  /* Existing rooms irratti columns haaraa dabala */
  await query(`
    ALTER TABLE rooms
    ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''
  `);

  await query(`
    ALTER TABLE rooms
    ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false
  `);

  await query(`
    ALTER TABLE rooms
    ADD COLUMN IF NOT EXISTS club_code TEXT
  `);

  /* =====================================================
     ROOM MEMBERS
  ===================================================== */

  await query(`
    CREATE TABLE IF NOT EXISTS room_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      username TEXT,
      seat INTEGER,
      mic_on BOOLEAN DEFAULT false,
      camera_on BOOLEAN DEFAULT false,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(room_id, user_id),
      UNIQUE(room_id, seat)
    )
  `);

  await query(`
    ALTER TABLE room_members
    ADD COLUMN IF NOT EXISTS is_speaker BOOLEAN DEFAULT false
  `);

  await query(`
    ALTER TABLE room_members
    ADD COLUMN IF NOT EXISTS hand_raised BOOLEAN DEFAULT false
  `);

  /* =====================================================
     MESSAGES
  ===================================================== */

  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
      sender_name TEXT,
      receiver_id UUID REFERENCES users(id) ON DELETE CASCADE,
      room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
      class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  /* =====================================================
     FOLLOWS
  ===================================================== */

  await query(`
    CREATE TABLE IF NOT EXISTS follows (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
      following_id UUID REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(follower_id, following_id)
    )
  `);

  /* =====================================================
     NOTIFICATIONS
  ===================================================== */

  await query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      is_read BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  /* =====================================================
     CLUB CODE INDEX
  ===================================================== */

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS rooms_club_code_unique
    ON rooms(club_code)
    WHERE club_code IS NOT NULL
  `);

  /* =====================================================
     BACKFILL CLUB CODES
  ===================================================== */

  await query(`
    UPDATE rooms
    SET club_code = UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', ''), 1, 8))
    WHERE club_code IS NULL
  `);

  console.log("✅ Database migration completed.");
}

/* =========================================================
   JWT
========================================================= */

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username
    },
    JWT_SECRET,
    {
      expiresIn: "30d"
    }
  );
}

function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Login required"
      });
    }

    const token = header.substring(7);

    const decoded = jwt.verify(
      token,
      JWT_SECRET
    );

    req.user = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      error: "Token sirrii miti ykn yeroon isaa darbe."
    });
  }
}

/* =========================================================
   HEALTH
========================================================= */

app.get("/api/health", async (req, res) => {
  try {
    await query("SELECT 1");

    res.json({
      ok: true,
      status: "healthy",
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

/* =========================================================
   REGISTER
========================================================= */

app.post("/api/register", async (req, res) => {
  try {
    const {
      username,
      password,
      bio = "",
      avatar = ""
    } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: "Username fi password guuti."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "Password yoo xiqqaate qubee 6 qabaachuu qaba."
      });
    }

    const cleanUsername =
      String(username).trim().toLowerCase();

    const exists = await query(
      `
      SELECT id
      FROM users
      WHERE username = $1
      `,
      [cleanUsername]
    );

    if (exists.rows.length) {
      return res.status(409).json({
        error: "Username kun duraan jira."
      });
    }

    const passwordHash =
      await bcrypt.hash(password, 12);

    const result = await query(
      `
      INSERT INTO users
      (username, password_hash, bio, avatar, status)
      VALUES ($1, $2, $3, $4, 'online')
      RETURNING
        id,
        username,
        bio,
        avatar,
        status,
        created_at
      `,
      [
        cleanUsername,
        passwordHash,
        bio,
        avatar
      ]
    );

    const user = result.rows[0];

    const token = createToken(user);

    res.json({
      ok: true,
      token,
      user
    });
  } catch (error) {
    console.error("REGISTER ERROR:", error);

    res.status(500).json({
      error: "Galmeen hin milkoofne.",
      detail: error.message
    });
  }
});

/* =========================================================
   LOGIN
========================================================= */

app.post("/api/login", async (req, res) => {
  try {
    const {
      username,
      password
    } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: "Username fi password guuti."
      });
    }

    const result = await query(
      `
      SELECT *
      FROM users
      WHERE username = $1
      `,
      [
        String(username).trim().toLowerCase()
      ]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        error: "Username ykn password sirrii miti."
      });
    }

    const user = result.rows[0];

    const valid =
      await bcrypt.compare(
        password,
        user.password_hash
      );

    if (!valid) {
      return res.status(401).json({
        error: "Username ykn password sirrii miti."
      });
    }

    await query(
      `
      UPDATE users
      SET
        status = 'online',
        last_seen = NOW()
      WHERE id = $1
      `,
      [user.id]
    );

    delete user.password_hash;

    const token = createToken(user);

    res.json({
      ok: true,
      token,
      user
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);

    res.status(500).json({
      error: "Login hin milkoofne."
    });
  }
});

/* =========================================================
   ME
========================================================= */

app.get("/api/me", auth, async (req, res) => {
  try {
    const result = await query(
      `
      SELECT
        id,
        username,
        bio,
        avatar,
        status,
        last_seen,
        created_at
      FROM users
      WHERE id = $1
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
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================================================
   USERS SEARCH
========================================================= */

app.get("/api/users", auth, async (req, res) => {
  try {
    const search =
      String(req.query.search || "").trim();

    const result = await query(
      `
      SELECT
        id,
        username,
        bio,
        avatar,
        status,
        last_seen
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
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================================================
   POSTS
========================================================= */

app.get("/api/posts", auth, async (req, res) => {
  try {
    const result = await query(`
      SELECT
        p.*,
        COUNT(DISTINCT pl.id)::int AS likes,
        COUNT(DISTINCT c.id)::int AS comments,
        COUNT(DISTINCT ps.id)::int AS shares
      FROM posts p
      LEFT JOIN post_likes pl
        ON pl.post_id = p.id
      LEFT JOIN comments c
        ON c.post_id = p.id
      LEFT JOIN post_shares ps
        ON ps.post_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT 100
    `);

    res.json({
      posts: result.rows
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.post("/api/posts", auth, async (req, res) => {
  try {
    const {
      content = "",
      image_url = ""
    } = req.body;

    if (!content.trim() && !image_url) {
      return res.status(400).json({
        error: "Post duwwaa ta'uu qaba."
      });
    }

    const userResult = await query(
      `
      SELECT username
      FROM users
      WHERE id = $1
      `,
      [req.user.id]
    );

    const username =
      userResult.rows[0]?.username ||
      req.user.username;

    const result = await query(
      `
      INSERT INTO posts
      (user_id, username, content, image_url)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [
        req.user.id,
        username,
        content,
        image_url
      ]
    );

    res.json({
      ok: true,
      post: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================================================
   LIKE
========================================================= */

app.post(
  "/api/posts/:id/like",
  auth,
  async (req, res) => {
    try {
      const postId = req.params.id;

      const exists = await query(
        `
        SELECT id
        FROM post_likes
        WHERE post_id = $1
        AND user_id = $2
        `,
        [
          postId,
          req.user.id
        ]
      );

      if (exists.rows.length) {
        await query(
          `
          DELETE FROM post_likes
          WHERE post_id = $1
          AND user_id = $2
          `,
          [
            postId,
            req.user.id
          ]
        );

        return res.json({
          liked: false
        });
      }

      await query(
        `
        INSERT INTO post_likes
        (post_id, user_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        `,
        [
          postId,
          req.user.id
        ]
      );

      res.json({
        liked: true
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   COMMENTS
========================================================= */

app.get(
  "/api/posts/:id/comments",
  auth,
  async (req, res) => {
    try {
      const result = await query(
        `
        SELECT *
        FROM comments
        WHERE post_id = $1
        ORDER BY created_at ASC
        `,
        [req.params.id]
      );

      res.json({
        comments: result.rows
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.post(
  "/api/posts/:id/comments",
  auth,
  async (req, res) => {
    try {
      const {
        content = ""
      } = req.body;

      if (!content.trim()) {
        return res.status(400).json({
          error: "Comment barreessi."
        });
      }

      const result = await query(
        `
        INSERT INTO comments
        (
          post_id,
          user_id,
          username,
          content
        )
        VALUES ($1, $2, $3, $4)
        RETURNING *
        `,
        [
          req.params.id,
          req.user.id,
          req.user.username,
          content.trim()
        ]
      );

      res.json({
        ok: true,
        comment: result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   SHARE
========================================================= */

app.post(
  "/api/posts/:id/share",
  auth,
  async (req, res) => {
    try {
      await query(
        `
        INSERT INTO post_shares
        (post_id, user_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        `,
        [
          req.params.id,
          req.user.id
        ]
      );

      res.json({
        ok: true
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   CLASSES
========================================================= */

app.post(
  "/api/classes",
  auth,
  async (req, res) => {
    try {
      const {
        name
      } = req.body;

      if (!name?.trim()) {
        return res.status(400).json({
          error: "Maqaa class guuti."
        });
      }

      const result = await query(
        `
        INSERT INTO classes
        (
          name,
          owner_id,
          owner_name
        )
        VALUES ($1, $2, $3)
        RETURNING *
        `,
        [
          name.trim(),
          req.user.id,
          req.user.username
        ]
      );

      const classroom =
        result.rows[0];

      await query(
        `
        INSERT INTO class_members
        (
          class_id,
          user_id,
          username,
          seat
        )
        VALUES ($1, $2, $3, 1)
        ON CONFLICT DO NOTHING
        `,
        [
          classroom.id,
          req.user.id,
          req.user.username
        ]
      );

      res.json({
        ok: true,
        class: classroom
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.get(
  "/api/classes",
  auth,
  async (req, res) => {
    try {
      const result = await query(`
        SELECT
          c.*,
          COUNT(cm.id)::int AS members
        FROM classes c
        LEFT JOIN class_members cm
          ON cm.class_id = c.id
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `);

      res.json({
        classes: result.rows
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.get(
  "/api/classes/:id",
  auth,
  async (req, res) => {
    try {
      const classResult =
        await query(
          `
          SELECT *
          FROM classes
          WHERE id = $1
          `,
          [req.params.id]
        );

      if (!classResult.rows.length) {
        return res.status(404).json({
          error: "Class hin argamne."
        });
      }

      const members =
        await query(
          `
          SELECT *
          FROM class_members
          WHERE class_id = $1
          ORDER BY
            CASE
              WHEN seat IS NULL THEN 999
              ELSE seat
            END
          `,
          [req.params.id]
        );

      res.json({
        class: classResult.rows[0],
        members: members.rows
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.post(
  "/api/classes/:id/join",
  auth,
  async (req, res) => {
    try {
      const classId =
        req.params.id;

      const classroom =
        await query(
          `
          SELECT *
          FROM classes
          WHERE id = $1
          `,
          [classId]
        );

      if (!classroom.rows.length) {
        return res.status(404).json({
          error: "Class hin argamne."
        });
      }

      const existing =
        await query(
          `
          SELECT *
          FROM class_members
          WHERE class_id = $1
          AND user_id = $2
          `,
          [
            classId,
            req.user.id
          ]
        );

      if (existing.rows.length) {
        return res.json({
          ok: true,
          member: existing.rows[0]
        });
      }

      let seat = null;

      for (let i = 2; i <= 10; i++) {
        const check =
          await query(
            `
            SELECT id
            FROM class_members
            WHERE class_id = $1
            AND seat = $2
            `,
            [
              classId,
              i
            ]
          );

        if (!check.rows.length) {
          seat = i;
          break;
        }
      }

      const result =
        await query(
          `
          INSERT INTO class_members
          (
            class_id,
            user_id,
            username,
            seat
          )
          VALUES ($1, $2, $3, $4)
          RETURNING *
          `,
          [
            classId,
            req.user.id,
            req.user.username,
            seat
          ]
        );

      io.to(`class:${classId}`).emit(
        "classMemberChanged"
      );

      res.json({
        ok: true,
        member: result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.post(
  "/api/classes/:id/leave",
  auth,
  async (req, res) => {
    try {
      await query(
        `
        DELETE FROM class_members
        WHERE class_id = $1
        AND user_id = $2
        `,
        [
          req.params.id,
          req.user.id
        ]
      );

      io.to(`class:${req.params.id}`).emit(
        "classMemberChanged"
      );

      res.json({
        ok: true
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   VOICE CLUB CREATE
========================================================= */

app.post(
  "/api/rooms",
  auth,
  async (req, res) => {
    try {
      const {
        name,
        description = ""
      } = req.body;

      if (!name?.trim()) {
        return res.status(400).json({
          error: "Maqaa Club guuti."
        });
      }

      const result =
        await query(
          `
          INSERT INTO rooms
          (
            name,
            description,
            owner_id,
            owner_name,
            is_locked
          )
          VALUES
          ($1, $2, $3, $4, false)
          RETURNING *
          `,
          [
            name.trim(),
            description,
            req.user.id,
            req.user.username
          ]
        );

      const room =
        result.rows[0];

      const clubCode =
        String(room.id)
          .replace(/-/g, "")
          .substring(0, 8)
          .toUpperCase();

      await query(
        `
        UPDATE rooms
        SET club_code = $1
        WHERE id = $2
        `,
        [
          clubCode,
          room.id
        ]
      );

      await query(
        `
        INSERT INTO room_members
        (
          room_id,
          user_id,
          username,
          seat,
          mic_on,
          camera_on,
          is_speaker,
          hand_raised
        )
        VALUES
        ($1, $2, $3, 1, false, false, true, false)
        ON CONFLICT (room_id, user_id)
        DO UPDATE SET
          seat = 1,
          is_speaker = true
        `,
        [
          room.id,
          req.user.id,
          req.user.username
        ]
      );

      const finalRoom =
        await query(
          `
          SELECT *
          FROM rooms
          WHERE id = $1
          `,
          [room.id]
        );

      res.json({
        ok: true,
        room: finalRoom.rows[0],
        clubCode
      });
    } catch (error) {
      console.error("CREATE ROOM ERROR:", error);

      res.status(500).json({
        error: "Club uumuu hin dandeenye.",
        detail: error.message
      });
    }
  }
);

/* =========================================================
   GET ROOMS
========================================================= */

app.get(
  "/api/rooms",
  auth,
  async (req, res) => {
    try {
      const result =
        await query(`
          SELECT
            r.*,
            COUNT(
              CASE
                WHEN rm.is_speaker = true
                THEN 1
              END
            )::int AS speakers,
            COUNT(rm.id)::int AS members
          FROM rooms r
          LEFT JOIN room_members rm
            ON rm.room_id = r.id
          GROUP BY r.id
          ORDER BY r.created_at DESC
        `);

      res.json({
        rooms: result.rows
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   GET SINGLE ROOM
========================================================= */

app.get(
  "/api/rooms/:id",
  auth,
  async (req, res) => {
    try {
      const roomResult =
        await query(
          `
          SELECT *
          FROM rooms
          WHERE id = $1
          `,
          [req.params.id]
        );

      if (!roomResult.rows.length) {
        return res.status(404).json({
          error: "Club hin argamne."
        });
      }

      const members =
        await query(
          `
          SELECT
            id,
            user_id,
            username,
            seat,
            mic_on,
            camera_on,
            is_speaker,
            hand_raised,
            joined_at
          FROM room_members
          WHERE room_id = $1
          ORDER BY
            CASE
              WHEN seat IS NULL THEN 999
              ELSE seat
            END,
            joined_at
          `,
          [req.params.id]
        );

      const speakers =
        members.rows.filter(
          m => m.is_speaker
        );

      const audience =
        members.rows.filter(
          m => !m.is_speaker
        );

      res.json({
        room: roomResult.rows[0],
        members: members.rows,
        speakers,
        audience,
        speakerCount: speakers.length,
        audienceCount: audience.length
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   JOIN VOICE CLUB
========================================================= */

app.post(
  "/api/rooms/:id/join",
  auth,
  async (req, res) => {
    try {
      const roomId =
        req.params.id;

      const roomResult =
        await query(
          `
          SELECT *
          FROM rooms
          WHERE id = $1
          `,
          [roomId]
        );

      if (!roomResult.rows.length) {
        return res.status(404).json({
          error: "Club hin argamne."
        });
      }

      const room =
        roomResult.rows[0];

      const existing =
        await query(
          `
          SELECT *
          FROM room_members
          WHERE room_id = $1
          AND user_id = $2
          `,
          [
            roomId,
            req.user.id
          ]
        );

      if (existing.rows.length) {
        return res.json({
          ok: true,
          member: existing.rows[0]
        });
      }

      if (
        room.is_locked &&
        room.owner_id !== req.user.id
      ) {
        return res.status(403).json({
          error: "Club cufameera."
        });
      }

      let seat = null;
      let isSpeaker = false;

      /* HOST */
      if (room.owner_id === req.user.id) {
        seat = 1;
        isSpeaker = true;
      } else {
        /* SPEAKER SEATS 2-10 */
        for (let i = 2; i <= 10; i++) {
          const check =
            await query(
              `
              SELECT id
              FROM room_members
              WHERE room_id = $1
              AND seat = $2
              `,
              [
                roomId,
                i
              ]
            );

          if (!check.rows.length) {
            seat = i;
            isSpeaker = true;
            break;
          }
        }
      }

      const result =
        await query(
          `
          INSERT INTO room_members
          (
            room_id,
            user_id,
            username,
            seat,
            mic_on,
            camera_on,
            is_speaker,
            hand_raised
          )
          VALUES
          ($1, $2, $3, $4, false, false, $5, false)
          RETURNING *
          `,
          [
            roomId,
            req.user.id,
            req.user.username,
            seat,
            isSpeaker
          ]
        );

      io.to(`room:${roomId}`).emit(
        "roomMemberChanged"
      );

      io.to(`room:${roomId}`).emit(
        "roomUserJoined",
        {
          userId: req.user.id,
          username: req.user.username,
          isSpeaker
        }
      );

      res.json({
        ok: true,
        member: result.rows[0]
      });
    } catch (error) {
      console.error("JOIN ROOM ERROR:", error);

      res.status(500).json({
        error: "Club seenuun hin dandeenye.",
        detail: error.message
      });
    }
  }
);

/* =========================================================
   LEAVE ROOM
========================================================= */

app.post(
  "/api/rooms/:id/leave",
  auth,
  async (req, res) => {
    try {
      const roomId =
        req.params.id;

      await query(
        `
        DELETE FROM room_members
        WHERE room_id = $1
        AND user_id = $2
        `,
        [
          roomId,
          req.user.id
        ]
      );

      io.to(`room:${roomId}`).emit(
        "roomMemberChanged"
      );

      io.to(`room:${roomId}`).emit(
        "roomUserLeft",
        {
          userId: req.user.id
        }
      );

      res.json({
        ok: true
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   MIC
========================================================= */

app.post(
  "/api/rooms/:id/mic",
  auth,
  async (req, res) => {
    try {
      const {
        mic_on
      } = req.body;

      const result =
        await query(
          `
          UPDATE room_members
          SET mic_on = $1
          WHERE room_id = $2
          AND user_id = $3
          RETURNING *
          `,
          [
            Boolean(mic_on),
            req.params.id,
            req.user.id
          ]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Ati club keessa hin jirtu."
        });
      }

      io.to(`room:${req.params.id}`).emit(
        "voiceState",
        {
          userId: req.user.id,
          mic_on: Boolean(mic_on)
        }
      );

      res.json({
        ok: true,
        member: result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   RAISE HAND
========================================================= */

app.post(
  "/api/rooms/:id/raise-hand",
  auth,
  async (req, res) => {
    try {
      const {
        hand_raised
      } = req.body;

      const result =
        await query(
          `
          UPDATE room_members
          SET hand_raised = $1
          WHERE room_id = $2
          AND user_id = $3
          RETURNING *
          `,
          [
            Boolean(hand_raised),
            req.params.id,
            req.user.id
          ]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Ati club keessa hin jirtu."
        });
      }

      io.to(`room:${req.params.id}`).emit(
        "handRaised",
        {
          userId: req.user.id,
          hand_raised: Boolean(hand_raised)
        }
      );

      res.json({
        ok: true,
        member: result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   HOST CHECK
========================================================= */

async function isRoomOwner(
  roomId,
  userId
) {
  const result =
    await query(
      `
      SELECT owner_id
      FROM rooms
      WHERE id = $1
      `,
      [roomId]
    );

  if (!result.rows.length) {
    return false;
  }

  return result.rows[0].owner_id === userId;
}

/* =========================================================
   LOCK / UNLOCK ROOM
========================================================= */

app.post(
  "/api/rooms/:id/lock",
  auth,
  async (req, res) => {
    try {
      const roomId =
        req.params.id;

      const owner =
        await isRoomOwner(
          roomId,
          req.user.id
        );

      if (!owner) {
        return res.status(403).json({
          error: "Host qofa."
        });
      }

      const {
        locked
      } = req.body;

      const result =
        await query(
          `
          UPDATE rooms
          SET is_locked = $1
          WHERE id = $2
          RETURNING *
          `,
          [
            Boolean(locked),
            roomId
          ]
        );

      io.to(`room:${roomId}`).emit(
        "roomLocked",
        {
          locked: Boolean(locked)
        }
      );

      res.json({
        ok: true,
        room: result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   PROMOTE
========================================================= */

app.post(
  "/api/rooms/:id/promote",
  auth,
  async (req, res) => {
    try {
      const roomId =
        req.params.id;

      const owner =
        await isRoomOwner(
          roomId,
          req.user.id
        );

      if (!owner) {
        return res.status(403).json({
          error: "Host qofa."
        });
      }

      const {
        userId
      } = req.body;

      const member =
        await query(
          `
          SELECT *
          FROM room_members
          WHERE room_id = $1
          AND user_id = $2
          `,
          [
            roomId,
            userId
          ]
        );

      if (!member.rows.length) {
        return res.status(404).json({
          error: "Member hin argamne."
        });
      }

      if (member.rows[0].is_speaker) {
        return res.json({
          ok: true,
          member: member.rows[0]
        });
      }

      let freeSeat = null;

      for (let i = 2; i <= 10; i++) {
        const check =
          await query(
            `
            SELECT id
            FROM room_members
            WHERE room_id = $1
            AND seat = $2
            `,
            [
              roomId,
              i
            ]
          );

        if (!check.rows.length) {
          freeSeat = i;
          break;
        }
      }

      if (!freeSeat) {
        return res.status(409).json({
          error: "Teessoon 10 guutameera."
        });
      }

      const result =
        await query(
          `
          UPDATE room_members
          SET
            seat = $1,
            is_speaker = true,
            hand_raised = false
          WHERE room_id = $2
          AND user_id = $3
          RETURNING *
          `,
          [
            freeSeat,
            roomId,
            userId
          ]
        );

      io.to(`room:${roomId}`).emit(
        "memberPromoted",
        {
          userId
        }
      );

      res.json({
        ok: true,
        member: result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   DEMOTE
========================================================= */

app.post(
  "/api/rooms/:id/demote",
  auth,
  async (req, res) => {
    try {
      const roomId =
        req.params.id;

      const owner =
        await isRoomOwner(
          roomId,
          req.user.id
        );

      if (!owner) {
        return res.status(403).json({
          error: "Host qofa."
        });
      }

      const {
        userId
      } = req.body;

      const result =
        await query(
          `
          UPDATE room_members
          SET
            seat = NULL,
            is_speaker = false,
            mic_on = false
          WHERE room_id = $1
          AND user_id = $2
          AND user_id <> (
            SELECT owner_id
            FROM rooms
            WHERE id = $1
          )
          RETURNING *
          `,
          [
            roomId,
            userId
          ]
        );

      if (!result.rows.length) {
        return res.status(400).json({
          error: "Member kana host ta'uu danda'a ykn hin argamne."
        });
      }

      io.to(`room:${roomId}`).emit(
        "memberDemoted",
        {
          userId
        }
      );

      res.json({
        ok: true,
        member: result.rows[0]
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   HOST MUTE
========================================================= */

app.post(
  "/api/rooms/:id/mute",
  auth,
  async (req, res) => {
    try {
      const roomId =
        req.params.id;

      const owner =
        await isRoomOwner(
          roomId,
          req.user.id
        );

      if (!owner) {
        return res.status(403).json({
          error: "Host qofa."
        });
      }

      const {
        userId
      } = req.body;

      await query(
        `
        UPDATE room_members
        SET mic_on = false
        WHERE room_id = $1
        AND user_id = $2
        `,
        [
          roomId,
          userId
        ]
      );

      io.to(`room:${roomId}`).emit(
        "hostMute",
        {
          userId
        }
      );

      res.json({
        ok: true
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   REMOVE MEMBER
========================================================= */

app.post(
  "/api/rooms/:id/remove",
  auth,
  async (req, res) => {
    try {
      const roomId =
        req.params.id;

      const owner =
        await isRoomOwner(
          roomId,
          req.user.id
        );

      if (!owner) {
        return res.status(403).json({
          error: "Host qofa."
        });
      }

      const {
        userId
      } = req.body;

      const target =
        await query(
          `
          SELECT *
          FROM room_members
          WHERE room_id = $1
          AND user_id = $2
          `,
          [
            roomId,
            userId
          ]
        );

      if (!target.rows.length) {
        return res.status(404).json({
          error: "Member hin argamne."
        });
      }

      const room =
        await query(
          `
          SELECT owner_id
          FROM rooms
          WHERE id = $1
          `,
          [roomId]
        );

      if (
        room.rows[0].owner_id === userId
      ) {
        return res.status(400).json({
          error: "Host of keessaa baasuu hin dandeessu."
        });
      }

      await query(
        `
        DELETE FROM room_members
        WHERE room_id = $1
        AND user_id = $2
        `,
        [
          roomId,
          userId
        ]
      );

      io.to(`room:${roomId}`).emit(
        "memberRemoved",
        {
          userId
        }
      );

      res.json({
        ok: true
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   ROOM MESSAGES
========================================================= */

app.get(
  "/api/rooms/:id/messages",
  auth,
  async (req, res) => {
    try {
      const result =
        await query(
          `
          SELECT *
          FROM messages
          WHERE room_id = $1
          ORDER BY created_at ASC
          LIMIT 200
          `,
          [req.params.id]
        );

      res.json({
        messages: result.rows
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   FOLLOW
========================================================= */

app.post(
  "/api/users/:id/follow",
  auth,
  async (req, res) => {
    try {
      const targetId =
        req.params.id;

      if (targetId === req.user.id) {
        return res.status(400).json({
          error: "Ofii kee follow gochuu hin dandeessu."
        });
      }

      const exists =
        await query(
          `
          SELECT id
          FROM follows
          WHERE follower_id = $1
          AND following_id = $2
          `,
          [
            req.user.id,
            targetId
          ]
        );

      if (exists.rows.length) {
        await query(
          `
          DELETE FROM follows
          WHERE follower_id = $1
          AND following_id = $2
          `,
          [
            req.user.id,
            targetId
          ]
        );

        return res.json({
          following: false
        });
      }

      await query(
        `
        INSERT INTO follows
        (
          follower_id,
          following_id
        )
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        `,
        [
          req.user.id,
          targetId
        ]
      );

      res.json({
        following: true
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   NOTIFICATIONS
========================================================= */

app.get(
  "/api/notifications",
  auth,
  async (req, res) => {
    try {
      const result =
        await query(
          `
          SELECT *
          FROM notifications
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT 100
          `,
          [req.user.id]
        );

      res.json({
        notifications: result.rows
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   SOCKET.IO
========================================================= */

const onlineUsers = new Map();

io.on("connection", (socket) => {
  console.log(
    "🔌 Socket connected:",
    socket.id
  );

  /* -------------------------------------------------------
     AUTH USER
  ------------------------------------------------------- */

  socket.on("authenticate", async (token) => {
    try {
      const decoded =
        jwt.verify(
          token,
          JWT_SECRET
        );

      socket.user = decoded;

      onlineUsers.set(
        decoded.id,
        socket.id
      );

      await query(
        `
        UPDATE users
        SET
          status = 'online',
          last_seen = NOW()
        WHERE id = $1
        `,
        [decoded.id]
      );

      socket.emit(
        "authenticated",
        {
          ok: true,
          user: decoded
        }
      );

      io.emit(
        "userOnline",
        {
          userId: decoded.id
        }
      );
    } catch (error) {
      socket.emit(
        "authenticated",
        {
          ok: false
        }
      );
    }
  });

  /* -------------------------------------------------------
     JOIN ROOM
  ------------------------------------------------------- */

  socket.on("joinRoom", async (roomId) => {
    try {
      if (!socket.user) return;

      socket.join(`room:${roomId}`);

      socket.roomId = roomId;

      const members =
        await query(
          `
          SELECT
            user_id,
            username,
            seat,
            mic_on,
            is_speaker,
            hand_raised
          FROM room_members
          WHERE room_id = $1
          ORDER BY
            CASE
              WHEN seat IS NULL THEN 999
              ELSE seat
            END
          `,
          [roomId]
        );

      socket.emit(
        "roomState",
        {
          members: members.rows
        }
      );

      socket.to(
        `room:${roomId}`
      ).emit(
        "roomUserJoined",
        {
          userId: socket.user.id,
          username: socket.user.username
        }
      );
    } catch (error) {
      console.error(
        "joinRoom socket error:",
        error.message
      );
    }
  });

  /* -------------------------------------------------------
     LEAVE ROOM
  ------------------------------------------------------- */

  socket.on("leaveRoom", (roomId) => {
    socket.leave(`room:${roomId}`);

    socket.to(
      `room:${roomId}`
    ).emit(
      "roomUserLeft",
      {
        userId:
          socket.user?.id
      }
    );

    socket.roomId = null;
  });

  /* -------------------------------------------------------
     ROOM MESSAGE
  ------------------------------------------------------- */

  socket.on(
    "roomMessage",
    async (data) => {
      try {
        if (!socket.user) return;

        const {
          roomId,
          content
        } = data;

        if (!content?.trim()) return;

        const result =
          await query(
            `
            INSERT INTO messages
            (
              sender_id,
              sender_name,
              room_id,
              content
            )
            VALUES ($1, $2, $3, $4)
            RETURNING *
            `,
            [
              socket.user.id,
              socket.user.username,
              roomId,
              content.trim()
            ]
          );

        io.to(
          `room:${roomId}`
        ).emit(
          "roomMessage",
          result.rows[0]
        );
      } catch (error) {
        console.error(
          "roomMessage:",
          error.message
        );
      }
    }
  );

  /* -------------------------------------------------------
     CLASS
  ------------------------------------------------------- */

  socket.on(
    "joinClass",
    (classId) => {
      socket.join(
        `class:${classId}`
      );

      socket.classId = classId;
    }
  );

  socket.on(
    "classMessage",
    async (data) => {
      try {
        if (!socket.user) return;

        const {
          classId,
          content
        } = data;

        if (!content?.trim()) return;

        const result =
          await query(
            `
            INSERT INTO messages
            (
              sender_id,
              sender_name,
              class_id,
              content
            )
            VALUES ($1, $2, $3, $4)
            RETURNING *
            `,
            [
              socket.user.id,
              socket.user.username,
              classId,
              content.trim()
            ]
          );

        io.to(
          `class:${classId}`
        ).emit(
          "classMessage",
          result.rows[0]
        );
      } catch (error) {
        console.error(
          "classMessage:",
          error.message
        );
      }
    }
  );

  /* -------------------------------------------------------
     PRIVATE MESSAGE
  ------------------------------------------------------- */

  socket.on(
    "privateMessage",
    async (data) => {
      try {
        if (!socket.user) return;

        const {
          receiverId,
          content
        } = data;

        if (!receiverId || !content?.trim()) {
          return;
        }

        const result =
          await query(
            `
            INSERT INTO messages
            (
              sender_id,
              sender_name,
              receiver_id,
              content
            )
            VALUES ($1, $2, $3, $4)
            RETURNING *
            `,
            [
              socket.user.id,
              socket.user.username,
              receiverId,
              content.trim()
            ]
          );

        const receiverSocket =
          onlineUsers.get(
            receiverId
          );

        if (receiverSocket) {
          io.to(
            receiverSocket
          ).emit(
            "privateMessage",
            result.rows[0]
          );
        }

        socket.emit(
          "privateMessage",
          result.rows[0]
        );
      } catch (error) {
        console.error(
          "privateMessage:",
          error.message
        );
      }
    }
  );

  /* -------------------------------------------------------
     WEBRTC OFFER
  ------------------------------------------------------- */

  socket.on(
    "offer",
    (data) => {
      const {
        target,
        offer
      } = data;

      io.to(target).emit(
        "offer",
        {
          from: socket.id,
          offer
        }
      );
    }
  );

  /* -------------------------------------------------------
     WEBRTC ANSWER
  ------------------------------------------------------- */

  socket.on(
    "answer",
    (data) => {
      const {
        target,
        answer
      } = data;

      io.to(target).emit(
        "answer",
        {
          from: socket.id,
          answer
        }
      );
    }
  );

  /* -------------------------------------------------------
     ICE
  ------------------------------------------------------- */

  socket.on(
    "ice-candidate",
    (data) => {
      const {
        target,
        candidate
      } = data;

      io.to(target).emit(
        "ice-candidate",
        {
          from: socket.id,
          candidate
        }
      );
    }
  );

  /* -------------------------------------------------------
     MIC STATUS
  ------------------------------------------------------- */

  socket.on(
    "micStatus",
    async (data) => {
      try {
        if (!socket.user) return;

        const {
          roomId,
          micOn
        } = data;

        await query(
          `
          UPDATE room_members
          SET mic_on = $1
          WHERE room_id = $2
          AND user_id = $3
          `,
          [
            Boolean(micOn),
            roomId,
            socket.user.id
          ]
        );

        io.to(
          `room:${roomId}`
        ).emit(
          "voiceState",
          {
            userId:
              socket.user.id,
            mic_on:
              Boolean(micOn)
          }
        );
      } catch (error) {
        console.error(
          "micStatus:",
          error.message
        );
      }
    }
  );

  /* -------------------------------------------------------
     CAMERA STATUS
  ------------------------------------------------------- */

  socket.on(
    "cameraStatus",
    async (data) => {
      try {
        if (!socket.user) return;

        const {
          roomId,
          cameraOn
        } = data;

        await query(
          `
          UPDATE room_members
          SET camera_on = $1
          WHERE room_id = $2
          AND user_id = $3
          `,
          [
            Boolean(cameraOn),
            roomId,
            socket.user.id
          ]
        );

        io.to(
          `room:${roomId}`
        ).emit(
          "cameraState",
          {
            userId:
              socket.user.id,
            camera_on:
              Boolean(cameraOn)
          }
        );
      } catch (error) {
        console.error(
          "cameraStatus:",
          error.message
        );
      }
    }
  );

  /* -------------------------------------------------------
     RAISE HAND SOCKET
  ------------------------------------------------------- */

  socket.on(
    "raiseHand",
    async (data) => {
      try {
        if (!socket.user) return;

        const {
          roomId,
          raised
        } = data;

        await query(
          `
          UPDATE room_members
          SET hand_raised = $1
          WHERE room_id = $2
          AND user_id = $3
          `,
          [
            Boolean(raised),
            roomId,
            socket.user.id
          ]
        );

        io.to(
          `room:${roomId}`
        ).emit(
          "handRaised",
          {
            userId:
              socket.user.id,
            hand_raised:
              Boolean(raised)
          }
        );
      } catch (error) {
        console.error(
          "raiseHand:",
          error.message
        );
      }
    }
  );

  /* -------------------------------------------------------
     DISCONNECT
  ------------------------------------------------------- */

  socket.on(
    "disconnect",
    async () => {
      console.log(
        "🔌 Socket disconnected:",
        socket.id
      );

      try {
        if (!socket.user) return;

        onlineUsers.delete(
          socket.user.id
        );

        await query(
          `
          UPDATE users
          SET
            status = 'offline',
            last_seen = NOW()
          WHERE id = $1
          `,
          [socket.user.id]
        );

        io.emit(
          "userOffline",
          {
            userId:
              socket.user.id
          }
        );

        if (socket.roomId) {
          socket.to(
            `room:${socket.roomId}`
          ).emit(
            "roomUserLeft",
            {
              userId:
                socket.user.id
            }
          );
        }
      } catch (error) {
        console.error(
          "disconnect error:",
          error.message
        );
      }
    }
  );
});

/* =========================================================
   FRONTEND FALLBACK
========================================================= */

app.get("*", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

/* =========================================================
   START SERVER
========================================================= */

async function start() {
  try {
    await testDatabase();

    await initDatabase();

    server.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `🚀 Mullisa-JM server running on port ${PORT}`
        );
      }
    );
  } catch (error) {
    console.error(
      "❌ Server/database error:",
      error.message
    );

    process.exit(1);
  }
}

start();
