const express = require("express");
const http = require("http");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;
const JWT_SECRET =
  process.env.JWT_SECRET || "mullisa-jm-change-this-secret";

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

/* =========================================================
   DATABASE
========================================================= */

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL hin argamne.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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

async function testDatabase() {
  let lastError;

  for (let i = 1; i <= 5; i++) {
    try {
      await query("SELECT NOW()");
      console.log("✅ Database connected.");
      return;
    } catch (err) {
      lastError = err;
      console.log(`⚠️ Database connection attempt ${i}/5 failed`);

      if (i < 5) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  throw lastError;
}

/* =========================================================
   DATABASE INIT / SAFE MIGRATION
   IMPORTANT:
   - DROP TABLE HIN JIRU
   - Existing data hin haqamu
========================================================= */

async function initDatabase() {
  console.log("🔧 Database migration jalqabame...");

  await query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto
  `);

  /* USERS */

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

  /* POSTS */

  await query(`
    CREATE TABLE IF NOT EXISTS posts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      image_url TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  /* POST LIKES */

  await query(`
    CREATE TABLE IF NOT EXISTS post_likes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(post_id, user_id)
    )
  `);

  /* COMMENTS */

  await query(`
    CREATE TABLE IF NOT EXISTS comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  /* SHARES */

  await query(`
    CREATE TABLE IF NOT EXISTS post_shares (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(post_id, user_id)
    )
  `);

  /* CLASSES */

  await query(`
    CREATE TABLE IF NOT EXISTS classes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      owner_name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  /* CLASS MEMBERS */

  await query(`
    CREATE TABLE IF NOT EXISTS class_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      seat INTEGER,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(class_id, user_id),
      UNIQUE(class_id, seat)
    )
  `);

  /* ROOMS */

  await query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      owner_name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  /*
    Existing rooms irratti columns haaraa dabala.
  */

  await query(`
    ALTER TABLE rooms
    ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''
  `);

  await query(`
    ALTER TABLE rooms
    ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE
  `);

  await query(`
    ALTER TABLE rooms
    ADD COLUMN IF NOT EXISTS club_code TEXT
  `);

  /*
    Room duraan jiraniif club_code guuti.
  */

  await query(`
    UPDATE rooms
    SET club_code = UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', ''), 1, 8))
    WHERE club_code IS NULL
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS rooms_club_code_unique
    ON rooms(club_code)
  `);

  /* ROOM MEMBERS */

  await query(`
    CREATE TABLE IF NOT EXISTS room_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      seat INTEGER,
      mic_on BOOLEAN DEFAULT TRUE,
      camera_on BOOLEAN DEFAULT TRUE,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(room_id, user_id),
      UNIQUE(room_id, seat)
    )
  `);

  await query(`
    ALTER TABLE room_members
    ADD COLUMN IF NOT EXISTS is_speaker BOOLEAN DEFAULT FALSE
  `);

  await query(`
    ALTER TABLE room_members
    ADD COLUMN IF NOT EXISTS hand_raised BOOLEAN DEFAULT FALSE
  `);

  /* MESSAGES */

  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_name TEXT NOT NULL,
      receiver_id UUID REFERENCES users(id) ON DELETE CASCADE,
      room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
      class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  /* FOLLOWS */

  await query(`
    CREATE TABLE IF NOT EXISTS follows (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(follower_id, following_id)
    )
  `);

  /* NOTIFICATIONS */

  await query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  /* INDEXES */

  await query(`
    CREATE INDEX IF NOT EXISTS posts_created_idx
    ON posts(created_at DESC)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS comments_post_idx
    ON comments(post_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS room_members_room_idx
    ON room_members(room_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS class_members_class_idx
    ON class_members(class_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS messages_room_idx
    ON messages(room_id, created_at)
  `);

  console.log("✅ Database migrations completed.");
}

/* =========================================================
   AUTH
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
        error: "Login godhi."
      });
    }

    const token = header.substring(7);

    const decoded = jwt.verify(
      token,
      JWT_SECRET
    );

    req.user = decoded;

    next();
  } catch {
    return res.status(401).json({
      error: "Token sirrii miti ykn yeroon isaa darbe."
    });
  }
}

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", async (req, res) => {
  try {
    await query("SELECT 1");

    res.json({
      ok: true,
      database: "connected",
      app: "Mullisa-JM"
    });
  } catch {
    res.status(500).json({
      ok: false,
      database: "error"
    });
  }
});

app.get("/api/health", async (req, res) => {
  try {
    await query("SELECT 1");

    res.json({
      ok: true,
      database: "connected",
      app: "Mullisa-JM"
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

/* =========================================================
   REGISTER
========================================================= */

app.post("/api/register", async (req, res) => {
  try {
    const username = String(
      req.body.username || ""
    ).trim();

    const password = String(
      req.body.password || ""
    );

    if (!username || !password) {
      return res.status(400).json({
        error: "Username fi password guuti."
      });
    }

    if (username.length < 3) {
      return res.status(400).json({
        error: "Username yoo xiqqaate qubee 3 qabaachuu qaba."
      });
    }

    if (password.length < 4) {
      return res.status(400).json({
        error: "Password yoo xiqqaate qubee 4 qabaachuu qaba."
      });
    }

    const exists = await query(
      `
      SELECT id
      FROM users
      WHERE LOWER(username) = LOWER($1)
      LIMIT 1
      `,
      [username]
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
      (username, password_hash, status)
      VALUES ($1, $2, 'online')
      RETURNING id, username, bio, avatar, status, created_at
      `,
      [username, passwordHash]
    );

    const user = result.rows[0];

    const token = createToken(user);

    res.json({
      token,
      user
    });

  } catch (err) {
    console.error("REGISTER ERROR:", err);

    res.status(500).json({
      error: "Galmeen hin milkoofne."
    });
  }
});

/* =========================================================
   LOGIN
========================================================= */

app.post("/api/login", async (req, res) => {
  try {
    const username = String(
      req.body.username || ""
    ).trim();

    const password = String(
      req.body.password || ""
    );

    const result = await query(
      `
      SELECT *
      FROM users
      WHERE LOWER(username) = LOWER($1)
      LIMIT 1
      `,
      [username]
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
      SET status = 'online',
          last_seen = NOW()
      WHERE id = $1
      `,
      [user.id]
    );

    delete user.password_hash;

    const token = createToken(user);

    res.json({
      token,
      user
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);

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

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

/* =========================================================
   USERS SEARCH
========================================================= */

app.get("/api/users", auth, async (req, res) => {
  try {
    const search = String(
      req.query.search || ""
    ).trim();

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
      AND id <> $2
      ORDER BY username
      LIMIT 30
      `,
      [`%${search}%`, req.user.id]
    );

    res.json({
      users: result.rows
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
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

        (
          SELECT COUNT(*)
          FROM post_likes l
          WHERE l.post_id = p.id
        )::int AS likes,

        (
          SELECT COUNT(*)
          FROM comments c
          WHERE c.post_id = p.id
        )::int AS comments,

        (
          SELECT COUNT(*)
          FROM post_shares s
          WHERE s.post_id = p.id
        )::int AS shares

      FROM posts p
      ORDER BY p.created_at DESC
      LIMIT 100
    `);

    res.json({
      posts: result.rows
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

app.post("/api/posts", auth, async (req, res) => {
  try {
    const content = String(
      req.body.content || ""
    ).trim();

    const image_url = String(
      req.body.image_url || ""
    ).trim();

    if (!content) {
      return res.status(400).json({
        error: "Post barreessi."
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

    if (!userResult.rows.length) {
      return res.status(404).json({
        error: "User hin argamne."
      });
    }

    const username =
      userResult.rows[0].username;

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

    io.emit("newPost", result.rows[0]);

    res.json({
      post: result.rows[0]
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

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
        [postId, req.user.id]
      );

      if (exists.rows.length) {
        await query(
          `
          DELETE FROM post_likes
          WHERE post_id = $1
          AND user_id = $2
          `,
          [postId, req.user.id]
        );
      } else {
        await query(
          `
          INSERT INTO post_likes
          (post_id, user_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
          `,
          [postId, req.user.id]
        );
      }

      const count = await query(
        `
        SELECT COUNT(*)::int AS count
        FROM post_likes
        WHERE post_id = $1
        `,
        [postId]
      );

      io.emit("postLikeChanged", {
        postId,
        likes: count.rows[0].count
      });

      res.json({
        likes: count.rows[0].count
      });

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

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

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

app.post(
  "/api/posts/:id/comments",
  auth,
  async (req, res) => {
    try {
      const content = String(
        req.body.content || ""
      ).trim();

      if (!content) {
        return res.status(400).json({
          error: "Comment barreessi."
        });
      }

      const user = await query(
        `
        SELECT username
        FROM users
        WHERE id = $1
        `,
        [req.user.id]
      );

      const username =
        user.rows[0]?.username ||
        req.user.username;

      const result = await query(
        `
        INSERT INTO comments
        (post_id, user_id, username, content)
        VALUES ($1, $2, $3, $4)
        RETURNING *
        `,
        [
          req.params.id,
          req.user.id,
          username,
          content
        ]
      );

      const comment = result.rows[0];

      io.emit("newComment", {
        ...comment,
        post_id: req.params.id
      });

      res.json({
        comment
      });

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

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

      const count = await query(
        `
        SELECT COUNT(*)::int AS count
        FROM post_shares
        WHERE post_id = $1
        `,
        [req.params.id]
      );

      res.json({
        shares: count.rows[0].count
      });

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

/* =========================================================
   CLASSES
========================================================= */

app.post("/api/classes", auth, async (req, res) => {
  try {
    const name = String(
      req.body.name || ""
    ).trim();

    if (!name) {
      return res.status(400).json({
        error: "Maqaa kilaasii galchi."
      });
    }

    const user = await query(
      `
      SELECT username
      FROM users
      WHERE id = $1
      `,
      [req.user.id]
    );

    const username =
      user.rows[0]?.username ||
      req.user.username;

    const result = await query(
      `
      INSERT INTO classes
      (name, owner_id, owner_name)
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [
        name,
        req.user.id,
        username
      ]
    );

    const cls = result.rows[0];

    await query(
      `
      INSERT INTO class_members
      (class_id, user_id, username, seat)
      VALUES ($1, $2, $3, 1)
      ON CONFLICT (class_id, user_id)
      DO UPDATE SET seat = 1
      `,
      [
        cls.id,
        req.user.id,
        username
      ]
    );

    res.json({
      class: cls
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

app.get("/api/classes", auth, async (req, res) => {
  try {
    const result = await query(`
      SELECT
        c.*,
        (
          SELECT COUNT(*)
          FROM class_members cm
          WHERE cm.class_id = c.id
        )::int AS members
      FROM classes c
      ORDER BY c.created_at DESC
    `);

    res.json({
      classes: result.rows
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

app.get(
  "/api/classes/:id",
  auth,
  async (req, res) => {
    try {
      const cls = await query(
        `
        SELECT *
        FROM classes
        WHERE id = $1
        `,
        [req.params.id]
      );

      if (!cls.rows.length) {
        return res.status(404).json({
          error: "Kilaasiin hin argamne."
        });
      }

      const members = await query(
        `
        SELECT *
        FROM class_members
        WHERE class_id = $1
        ORDER BY seat NULLS LAST, joined_at
        `,
        [req.params.id]
      );

      res.json({
        class: cls.rows[0],
        members: members.rows
      });

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

app.post(
  "/api/classes/:id/join",
  auth,
  async (req, res) => {
    try {
      const classId = req.params.id;

      const cls = await query(
        `
        SELECT *
        FROM classes
        WHERE id = $1
        `,
        [classId]
      );

      if (!cls.rows.length) {
        return res.status(404).json({
          error: "Kilaasiin hin argamne."
        });
      }

      const existing = await query(
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
          seat: existing.rows[0].seat
        });
      }

      const user = await query(
        `
        SELECT username
        FROM users
        WHERE id = $1
        `,
        [req.user.id]
      );

      const username =
        user.rows[0]?.username ||
        req.user.username;

      const seats = await query(
        `
        SELECT seat
        FROM class_members
        WHERE class_id = $1
        AND seat IS NOT NULL
        `,
        [classId]
      );

      const used = new Set(
        seats.rows.map(x => Number(x.seat))
      );

      let seat = null;

      for (let i = 2; i <= 10; i++) {
        if (!used.has(i)) {
          seat = i;
          break;
        }
      }

      await query(
        `
        INSERT INTO class_members
        (class_id, user_id, username, seat)
        VALUES ($1, $2, $3, $4)
        `,
        [
          classId,
          req.user.id,
          username,
          seat
        ]
      );

      io.to(`class:${classId}`).emit(
        "classMemberChanged"
      );

      res.json({
        seat
      });

    } catch (err) {
      res.status(500).json({
        error: err.message
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

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

/* =========================================================
   VOICE CLUB / ROOMS
========================================================= */

/* CREATE ROOM */

app.post("/api/rooms", auth, async (req, res) => {
  try {
    const name = String(
      req.body.name || ""
    ).trim();

    const description = String(
      req.body.description || ""
    ).trim();

    if (!name) {
      return res.status(400).json({
        error: "Maqaa Room galchi."
      });
    }

    const user = await query(
      `
      SELECT username
      FROM users
      WHERE id = $1
      `,
      [req.user.id]
    );

    const username =
      user.rows[0]?.username ||
      req.user.username;

    let room;

    for (let attempt = 0; attempt < 5; attempt++) {
      const code =
        Math.random()
          .toString(36)
          .substring(2, 10)
          .toUpperCase();

      try {
        const result = await query(
          `
          INSERT INTO rooms
          (name, description, owner_id, owner_name, club_code)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
          `,
          [
            name,
            description,
            req.user.id,
            username,
            code
          ]
        );

        room = result.rows[0];
        break;

      } catch (err) {
        if (
          err.code === "23505" &&
          attempt < 4
        ) {
          continue;
        }

        throw err;
      }
    }

    if (!room) {
      throw new Error(
        "Club Code uumuu hin dandeenye."
      );
    }

    /* OWNER = SEAT 1 */

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
      ($1, $2, $3, 1, TRUE, TRUE, TRUE, FALSE)
      ON CONFLICT (room_id, user_id)
      DO UPDATE SET
        seat = 1,
        is_speaker = TRUE
      `,
      [
        room.id,
        req.user.id,
        username
      ]
    );

    res.json({
      room
    });

  } catch (err) {
    console.error("CREATE ROOM ERROR:", err);

    res.status(500).json({
      error: "Room uumuu hin dandeenye."
    });
  }
});

/* ROOM LIST */

app.get("/api/rooms", auth, async (req, res) => {
  try {
    const result = await query(`
      SELECT
        r.*,
        (
          SELECT COUNT(*)
          FROM room_members rm
          WHERE rm.room_id = r.id
        )::int AS members,

        (
          SELECT COUNT(*)
          FROM room_members rm
          WHERE rm.room_id = r.id
          AND rm.is_speaker = TRUE
        )::int AS speakers
      FROM rooms r
      ORDER BY r.created_at DESC
    `);

    res.json({
      rooms: result.rows
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

/* ROOM DETAILS */

app.get(
  "/api/rooms/:id",
  auth,
  async (req, res) => {
    try {
      const roomResult = await query(
        `
        SELECT *
        FROM rooms
        WHERE id = $1
        `,
        [req.params.id]
      );

      if (!roomResult.rows.length) {
        return res.status(404).json({
          error: "Room hin argamne."
        });
      }

      const members = await query(
        `
        SELECT
          id,
          room_id,
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
        ORDER BY seat NULLS LAST, joined_at
        `,
        [req.params.id]
      );

      res.json({
        room: roomResult.rows[0],
        members: members.rows
      });

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

/* JOIN ROOM */

app.post(
  "/api/rooms/:id/join",
  auth,
  async (req, res) => {
    try {
      const roomId = req.params.id;

      const roomResult = await query(
        `
        SELECT *
        FROM rooms
        WHERE id = $1
        `,
        [roomId]
      );

      if (!roomResult.rows.length) {
        return res.status(404).json({
          error: "Room hin argamne."
        });
      }

      const room = roomResult.rows[0];

      const existing = await query(
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

      /* HOST */

      if (
        String(room.owner_id) ===
        String(req.user.id)
      ) {
        const user = await query(
          `
          SELECT username
          FROM users
          WHERE id = $1
          `,
          [req.user.id]
        );

        const username =
          user.rows[0]?.username ||
          req.user.username;

        if (existing.rows.length) {
          await query(
            `
            UPDATE room_members
            SET
              seat = 1,
              is_speaker = TRUE
            WHERE room_id = $1
            AND user_id = $2
            `,
            [
              roomId,
              req.user.id
            ]
          );
        } else {
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
              is_speaker
            )
            VALUES
            ($1, $2, $3, 1, TRUE, TRUE, TRUE)
            `,
            [
              roomId,
              req.user.id,
              username
            ]
          );
        }

        io.to(`room:${roomId}`).emit(
          "roomMemberChanged"
        );

        return res.json({
          seat: 1,
          isSpeaker: true,
          isHost: true
        });
      }

      /* LOCKED */

      if (room.is_locked) {
        return res.status(403).json({
          error: "Room cufameera. Amma seenuu hin dandeessu."
        });
      }

      /* EXISTING MEMBER */

      if (existing.rows.length) {
        return res.json({
          seat: existing.rows[0].seat,
          isSpeaker: existing.rows[0].is_speaker,
          isHost: false
        });
      }

      const user = await query(
        `
        SELECT username
        FROM users
        WHERE id = $1
        `,
        [req.user.id]
      );

      const username =
        user.rows[0]?.username ||
        req.user.username;

      /* FIND SPEAKER SEAT 2-10 */

      const seats = await query(
        `
        SELECT seat
        FROM room_members
        WHERE room_id = $1
        AND seat IS NOT NULL
        `,
        [roomId]
      );

      const used = new Set(
        seats.rows.map(x => Number(x.seat))
      );

      let seat = null;

      for (let i = 2; i <= 10; i++) {
        if (!used.has(i)) {
          seat = i;
          break;
        }
      }

      /*
        Yoo teessoon speaker jiraate:
        speaker ta'a.
        Yoo guutame:
        audience ta'a.
      */

      const isSpeaker = seat !== null;

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
        ($1, $2, $3, $4, TRUE, TRUE, $5, FALSE)
        `,
        [
          roomId,
          req.user.id,
          username,
          seat,
          isSpeaker
        ]
      );

      io.to(`room:${roomId}`).emit(
        "roomMemberChanged"
      );

      res.json({
        seat,
        isSpeaker,
        isHost: false
      });

    } catch (err) {
      console.error("JOIN ROOM ERROR:", err);

      res.status(500).json({
        error: "Room seenuu hin dandeenye."
      });
    }
  }
);

/* LEAVE ROOM */

app.post(
  "/api/rooms/:id/leave",
  auth,
  async (req, res) => {
    try {
      await query(
        `
        DELETE FROM room_members
        WHERE room_id = $1
        AND user_id = $2
        `,
        [
          req.params.id,
          req.user.id
        ]
      );

      io.to(`room:${req.params.id}`).emit(
        "roomMemberChanged"
      );

      res.json({
        ok: true
      });

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

/* =========================================================
   ROOM MIC
========================================================= */

app.post(
  "/api/rooms/:id/mic",
  auth,
  async (req, res) => {
    try {
      const micOn =
        Boolean(req.body.micOn);

      const result = await query(
        `
        UPDATE room_members
        SET mic_on = $1
        WHERE room_id = $2
        AND user_id = $3
        RETURNING *
        `,
        [
          micOn,
          req.params.id,
          req.user.id
        ]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Room keessatti hin jirtu."
        });
      }

      io.to(`room:${req.params.id}`).emit(
        "micStatus",
        {
          userId: req.user.id,
          micOn
        }
      );

      res.json({
        ok: true,
        micOn
      });

    } catch (err) {
      res.status(500).json({
        error: err.message
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
      const raised =
        Boolean(req.body.raised);

      await query(
        `
        UPDATE room_members
        SET hand_raised = $1
        WHERE room_id = $2
        AND user_id = $3
        `,
        [
          raised,
          req.params.id,
          req.user.id
        ]
      );

      io.to(`room:${req.params.id}`).emit(
        "handRaised",
        {
          userId: req.user.id,
          raised
        }
      );

      res.json({
        ok: true,
        raised
      });

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

/* =========================================================
   HOST CHECK
========================================================= */

async function isRoomHost(roomId, userId) {
  const result = await query(
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

  return (
    String(result.rows[0].owner_id) ===
    String(userId)
  );
}

/* =========================================================
   LOCK / UNLOCK ROOM
========================================================= */

app.post(
  "/api/rooms/:id/lock",
  auth,
  async (req, res) => {
    try {
      const host =
        await isRoomHost(
          req.params.id,
          req.user.id
        );

      if (!host) {
        return res.status(403).json({
          error: "Abbaa Room qofa kana gochuu danda'a."
        });
      }

      const locked =
        Boolean(req.body.locked);

      await query(
        `
        UPDATE rooms
        SET is_locked = $1
        WHERE id = $2
        `,
        [
          locked,
          req.params.id
        ]
      );

      io.to(`room:${req.params.id}`).emit(
        "roomLocked",
        {
          locked
        }
      );

      res.json({
        ok: true,
        locked
      });

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

/* =========================================================
   PROMOTE MEMBER
========================================================= */

app.post(
  "/api/rooms/:id/promote",
  auth,
  async (req, res) => {
    try {
      const roomId = req.params.id;
      const userId = req.body.userId;

      const host =
        await isRoomHost(
          roomId,
          req.user.id
        );

      if (!host) {
        return res.status(403).json({
          error: "Host qofa."
        });
      }

      if (!userId) {
        return res.status(400).json({
          error: "User ID barbaachisa."
        });
      }

      const member = await query(
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

      const seats = await query(
        `
        SELECT seat
        FROM room_members
        WHERE room_id = $1
        AND seat IS NOT NULL
        `,
        [roomId]
      );

      const used = new Set(
        seats.rows.map(x => Number(x.seat))
      );

      let seat = null;

      for (let i = 2; i <= 10; i++) {
        if (!used.has(i)) {
          seat = i;
          break;
        }
      }

      if (!seat) {
        return res.status(409).json({
          error: "Teessoon 10 guutameera."
        });
      }

      await query(
        `
        UPDATE room_members
        SET
          seat = $1,
          is_speaker = TRUE
        WHERE room_id = $2
        AND user_id = $3
        `,
        [
          seat,
          roomId,
          userId
        ]
      );

      io.to(`room:${roomId}`).emit(
        "memberPromoted",
        {
          userId,
          seat
        }
      );

      res.json({
        ok: true,
        seat
      });

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

/* =========================================================
   DEMOTE MEMBER
========================================================= */

app.post(
  "/api/rooms/:id/demote",
  auth,
  async (req, res) => {
    try {
      const roomId = req.params.id;
      const userId = req.body.userId;

      const host =
        await isRoomHost(
          roomId,
          req.user.id
        );

      if (!host) {
        return res.status(403).json({
          error: "Host qofa."
        });
      }

      const room = await query(
        `
        SELECT owner_id
        FROM rooms
        WHERE id = $1
        `,
        [roomId]
      );

      if (
        room.rows.length &&
        String(room.rows[0].owner_id) ===
        String(userId)
      ) {
        return res.status(400).json({
          error: "Host demote gochuu hin dandeessu."
        });
      }

      await query(
        `
        UPDATE room_members
        SET
          seat = NULL,
          is_speaker = FALSE,
          mic_on = FALSE
        WHERE room_id = $1
        AND user_id = $2
        `,
        [
          roomId,
          userId
        ]
      );

      io.to(`room:${roomId}`).emit(
        "memberDemoted",
        {
          userId
        }
      );

      res.json({
        ok: true
      });

    } catch (err) {
      res.status(500).json({
        error: err.message
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
      const roomId = req.params.id;
      const userId = req.body.userId;

      const host =
        await isRoomHost(
          roomId,
          req.user.id
        );

      if (!host) {
        return res.status(403).json({
          error: "Host qofa."
        });
      }

      await query(
        `
        UPDATE room_members
        SET mic_on = FALSE
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

    } catch (err) {
      res.status(500).json({
        error: err.message
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
      const roomId = req.params.id;
      const userId = req.body.userId;

      const host =
        await isRoomHost(
          roomId,
          req.user.id
        );

      if (!host) {
        return res.status(403).json({
          error: "Host qofa."
        });
      }

      const room = await query(
        `
        SELECT owner_id
        FROM rooms
        WHERE id = $1
        `,
        [roomId]
      );

      if (
        room.rows.length &&
        String(room.rows[0].owner_id) ===
        String(userId)
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

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

/* =========================================================
   GENERAL FOLLOW
========================================================= */

app.post(
  "/api/users/:id/follow",
  auth,
  async (req, res) => {
    try {
      const targetId = req.params.id;

      if (
        String(targetId) ===
        String(req.user.id)
      ) {
        return res.status(400).json({
          error: "Ofii kee follow gochuu hin dandeessu."
        });
      }

      await query(
        `
        INSERT INTO follows
        (follower_id, following_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        `,
        [
          req.user.id,
          targetId
        ]
      );

      res.json({
        ok: true
      });

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

app.post(
  "/api/users/:id/unfollow",
  auth,
  async (req, res) => {
    try {
      await query(
        `
        DELETE FROM follows
        WHERE follower_id = $1
        AND following_id = $2
        `,
        [
          req.user.id,
          req.params.id
        ]
      );

      res.json({
        ok: true
      });

    } catch (err) {
      res.status(500).json({
        error: err.message
      });
    }
  }
);

/* =========================================================
   SOCKET.IO
========================================================= */

io.on("connection", socket => {
  console.log(
    "🔌 Socket connected:",
    socket.id
  );

  socket.on("userOnline", async data => {
    try {
      if (!data?.userId) return;

      await query(
        `
        UPDATE users
        SET
          status = 'online',
          last_seen = NOW()
        WHERE id = $1
        `,
        [data.userId]
      );

      socket.userId = data.userId;
      socket.username = data.username;

    } catch (err) {
      console.error(
        "userOnline:",
        err.message
      );
    }
  });

  /* CLASS */

  socket.on("joinClass", data => {
    if (!data?.classId) return;

    socket.join(
      `class:${data.classId}`
    );

    socket.classId =
      data.classId;
  });

  socket.on("leaveClass", data => {
    if (!data?.classId) return;

    socket.leave(
      `class:${data.classId}`
    );

    socket.classId = null;

    socket.to(
      `class:${data.classId}`
    ).emit(
      "classMemberChanged"
    );
  });

  socket.on("classMessage", async data => {
    try {
      if (
        !data?.classId ||
        !data?.userId ||
        !data?.content
      ) {
        return;
      }

      const message =
        String(data.content).trim();

      if (!message) return;

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
        `,
        [
          data.userId,
          data.username,
          data.classId,
          message
        ]
      );

      io.to(
        `class:${data.classId}`
      ).emit(
        "classMessage",
        {
          classId: data.classId,
          userId: data.userId,
          username: data.username,
          content: message,
          createdAt: new Date().toISOString()
        }
      );

    } catch (err) {
      console.error(
        "classMessage:",
        err.message
      );
    }
  });

  /* ROOM */

  socket.on("joinRoom", data => {
    if (!data?.roomId) return;

    socket.join(
      `room:${data.roomId}`
    );

    socket.roomId =
      data.roomId;

    socket.userId =
      data.userId;

    socket.username =
      data.username;

    socket.to(
      `room:${data.roomId}`
    ).emit(
      "roomUserJoined",
      {
        roomId: data.roomId,
        userId: data.userId,
        username: data.username,
        seat: data.seat
      }
    );

    socket.to(
      `room:${data.roomId}`
    ).emit(
      "roomMemberChanged"
    );
  });

  socket.on("leaveRoom", data => {
    if (!data?.roomId) return;

    socket.leave(
      `room:${data.roomId}`
    );

    socket.to(
      `room:${data.roomId}`
    ).emit(
      "roomUserLeft",
      {
        roomId: data.roomId,
        userId: data.userId
      }
    );

    socket.to(
      `room:${data.roomId}`
    ).emit(
      "roomMemberChanged"
    );

    socket.roomId = null;
  });

  /* MIC */

  socket.on("micStatus", async data => {
    try {
      if (!data?.roomId) return;

      await query(
        `
        UPDATE room_members
        SET mic_on = $1
        WHERE room_id = $2
        AND user_id = $3
        `,
        [
          Boolean(data.micOn),
          data.roomId,
          data.userId
        ]
      );

      io.to(
        `room:${data.roomId}`
      ).emit(
        "micStatus",
        {
          userId: data.userId,
          micOn: Boolean(data.micOn)
        }
      );

    } catch (err) {
      console.error(
        "micStatus:",
        err.message
      );
    }
  });

  /* CAMERA */

  socket.on("cameraStatus", async data => {
    try {
      if (!data?.roomId) return;

      await query(
        `
        UPDATE room_members
        SET camera_on = $1
        WHERE room_id = $2
        AND user_id = $3
        `,
        [
          Boolean(data.cameraOn),
          data.roomId,
          data.userId
        ]
      );

      io.to(
        `room:${data.roomId}`
      ).emit(
        "cameraStatus",
        {
          userId: data.userId,
          cameraOn: Boolean(data.cameraOn)
        }
      );

    } catch (err) {
      console.error(
        "cameraStatus:",
        err.message
      );
    }
  });

  /* =====================================================
     WEBRTC SIGNALING
  ===================================================== */

  socket.on("offer", data => {
    if (!data?.to) return;

    io.to(data.to).emit(
      "offer",
      {
        from: socket.id,
        offer: data.offer,
        userId: data.userId
      }
    );
  });

  socket.on("answer", data => {
    if (!data?.to) return;

    io.to(data.to).emit(
      "answer",
      {
        from: socket.id,
        answer: data.answer,
        userId: data.userId
      }
    );
  });

  socket.on("ice-candidate", data => {
    if (!data?.to) return;

    io.to(data.to).emit(
      "ice-candidate",
      {
        from: socket.id,
        candidate: data.candidate
      }
    );
  });

  /* DISCONNECT */

  socket.on("disconnect", async () => {
    try {
      if (socket.userId) {
        await query(
          `
          UPDATE users
          SET
            status = 'offline',
            last_seen = NOW()
          WHERE id = $1
          `,
          [socket.userId]
        );
      }

      if (socket.roomId) {
        socket.to(
          `room:${socket.roomId}`
        ).emit(
          "roomUserLeft",
          {
            roomId: socket.roomId,
            userId: socket.userId
          }
        );
      }

      console.log(
        "🔌 Socket disconnected:",
        socket.id
      );

    } catch (err) {
      console.error(
        "disconnect:",
        err.message
      );
    }
  });
});

/* =========================================================
   STATIC FRONTEND
========================================================= */

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

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
   START
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

  } catch (err) {
    console.error(
      "❌ Server/database error:",
      err.message
    );

    process.exit(1);
  }
}

start();
