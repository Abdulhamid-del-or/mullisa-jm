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
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 10000;

const JWT_SECRET =
  process.env.JWT_SECRET || "mullisa-jm-change-this-secret";

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

/* =========================
   DATABASE
========================= */

let pool = null;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    },
    family: 4,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
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

/* =========================
   MIGRATION
========================= */

async function getUsersIdType() {
  const result = await db(`
    SELECT
      data_type,
      udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'id'
    LIMIT 1
  `);

  if (!result.rows.length) {
    return "INTEGER";
  }

  const type = result.rows[0].udt_name;

  if (type === "uuid") {
    return "UUID";
  }

  if (type === "int2") {
    return "SMALLINT";
  }

  if (type === "int4") {
    return "INTEGER";
  }

  if (type === "int8") {
    return "BIGINT";
  }

  return "TEXT";
}

async function migrate() {
  if (!pool) {
    console.log(
      "DATABASE_URL hin jiru. Database migration hin raawwatamne."
    );
    return;
  }

  /*
    USERS

    Yoo users duraan jiraate:
    hin jijjiiramu.
  */

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
   await db(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS name VARCHAR(120)
`);

await db(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username VARCHAR(80)
`);

await db(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT
`);

await db(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar TEXT
`);

await db(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT ''
`);

await db(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
`);

await db(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
` )
  `);

  const userIdType = await getUsersIdType();

  console.log(
    "Detected users.id type:",
    userIdType
  );

  /*
    MESSAGES

    Foreign key hin fayyadamu.
    Kun schema duraan jiru waliin
    conflict akka hin uumamneef.
  */

  await db(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      sender_id TEXT NOT NULL,
      receiver_id TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  /*
    CLUBS

    owner_id TEXT taasifame.
    Kanaaf users.id INTEGER,
    UUID ykn BIGINT ta'us
    FK type mismatch hin uumamu.
  */

  await db(`
    CREATE TABLE IF NOT EXISTS clubs (
      id SERIAL PRIMARY KEY,
      club_code VARCHAR(20) UNIQUE NOT NULL,
      name VARCHAR(150) NOT NULL,
      owner_id TEXT NOT NULL,
      locked BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  /*
    CLUB MEMBERS
  */

  await db(`
    CREATE TABLE IF NOT EXISTS club_members (
      id SERIAL PRIMARY KEY,
      club_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      role VARCHAR(30) DEFAULT 'listener',
      mic_on BOOLEAN DEFAULT FALSE,
      camera_on BOOLEAN DEFAULT FALSE,
      raised_hand BOOLEAN DEFAULT FALSE,
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(club_id, user_id)
    )
  `);

  /*
    CLUB MESSAGES
  */

  await db(`
    CREATE TABLE IF NOT EXISTS club_messages (
      id SERIAL PRIMARY KEY,
      club_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  /*
    Add missing columns safely.
  */

  await db(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar TEXT
  `);

  await db(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT ''
  `);

  await db(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);

  await db(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);

  await db(`
    ALTER TABLE clubs
    ADD COLUMN IF NOT EXISTS locked BOOLEAN DEFAULT FALSE
  `);

  await db(`
    ALTER TABLE club_members
    ADD COLUMN IF NOT EXISTS mic_on BOOLEAN DEFAULT FALSE
  `);

  await db(`
    ALTER TABLE club_members
    ADD COLUMN IF NOT EXISTS camera_on BOOLEAN DEFAULT FALSE
  `);

  await db(`
    ALTER TABLE club_members
    ADD COLUMN IF NOT EXISTS raised_hand BOOLEAN DEFAULT FALSE
  `);

  console.log(
    "Database migrations completed."
  );
}

/* =========================
   AUTH
========================= */

function auth(req, res, next) {
  const header =
    req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Login godhi."
    });
  }

  try {
    const token = header.substring(7);

    req.user = jwt.verify(
      token,
      JWT_SECRET
    );

    next();
  } catch (err) {
    return res.status(401).json({
      error: "Token sirrii miti."
    });
  }
}

function makeToken(user) {
  return jwt.sign(
    {
      id: String(user.id),
      username: user.username,
      name: user.name
    },
    JWT_SECRET,
    {
      expiresIn: "30d"
    }
  );
}

/* =========================
   CODE
========================= */

function randomCode() {
  return Math.random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase();
}

/* =========================
   HEALTH
========================= */

app.get("/health", async (req, res) => {
  let database = false;

  if (pool) {
    try {
      await db("SELECT 1");
      database = true;
    } catch (err) {
      database = false;
    }
  }

  res.json({
    ok: true,
    app: "Mullisa-JM",
    database,
    time: new Date().toISOString()
  });
});

/* =========================
   REGISTER
========================= */

app.post("/api/register", async (req, res) => {
  try {
    const name =
      String(req.body.name || "").trim();

    const username =
      String(req.body.username || "").trim();

    const password =
      String(req.body.password || "");

    if (!name || !username || !password) {
      return res.status(400).json({
        error:
          "Maqaa, username fi password guuti."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error:
          "Password yoo xiqqaate qubee 6 qabaachuu qaba."
      });
    }

    const exists = await db(
      `
      SELECT id
      FROM users
      WHERE LOWER(username)=LOWER($1)
      LIMIT 1
      `,
      [username]
    );

    if (exists.rows.length) {
      return res.status(409).json({
        error:
          "Username kun duraan jira."
      });
    }

    const hash =
      await bcrypt.hash(password, 10);

    const result = await db(
      `
      INSERT INTO users
      (
        name,
        username,
        password_hash
      )
      VALUES
      ($1,$2,$3)
      RETURNING
        id,
        name,
        username,
        avatar,
        bio
      `,
      [
        name,
        username,
        hash
      ]
    );

    const user = result.rows[0];

    res.json({
      ok: true,
      token: makeToken(user),
      user
    });

  } catch (err) {
    console.error(
      "REGISTER ERROR:",
      err
    );

    res.status(500).json({
      error:
        "Register irratti rakkoon uumame."
    });
  }
});

/* =========================
   LOGIN
========================= */

app.post("/api/login", async (req, res) => {
  try {
    const username =
      String(req.body.username || "").trim();

    const password =
      String(req.body.password || "");

    if (!username || !password) {
      return res.status(400).json({
        error:
          "Username fi password guuti."
      });
    }

    const result = await db(
      `
      SELECT *
      FROM users
      WHERE LOWER(username)=LOWER($1)
      LIMIT 1
      `,
      [username]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        error:
          "Username ykn password dogongora."
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
        error:
          "Username ykn password dogongora."
      });
    }

    await db(
      `
      UPDATE users
      SET last_seen=CURRENT_TIMESTAMP
      WHERE id=$1
      `,
      [user.id]
    );

    res.json({
      ok: true,

      token: makeToken(user),

      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        avatar: user.avatar || null,
        bio: user.bio || ""
      }
    });

  } catch (err) {
    console.error(
      "LOGIN ERROR:",
      err
    );

    res.status(500).json({
      error:
        "Login irratti rakkoon uumame."
    });
  }
});

/* =========================
   ME
========================= */

app.get("/api/me", auth, async (req, res) => {
  try {
    const result = await db(
      `
      SELECT
        id,
        name,
        username,
        avatar,
        bio,
        last_seen
      FROM users
      WHERE id=$1
      LIMIT 1
      `,
      [req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "User hin argamne."
      });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error("ME ERROR:", err);

    res.status(500).json({
      error:
        "Profile argachuu hin dandeenye."
    });
  }
});

/* =========================
   USERS SEARCH
========================= */

app.get("/api/users", auth, async (req, res) => {
  try {
    const q =
      String(req.query.q || "").trim();

    const result = await db(
      `
      SELECT
        id,
        name,
        username,
        avatar,
        last_seen
      FROM users
      WHERE CAST(id AS TEXT) <> $1
      AND (
        name ILIKE $2
        OR username ILIKE $2
      )
      ORDER BY name
      LIMIT 30
      `,
      [
        String(req.user.id),
        `%${q}%`
      ]
    );

    res.json(result.rows);

  } catch (err) {
    console.error(
      "USERS SEARCH ERROR:",
      err
    );

    res.status(500).json([]);
  }
});

/* =========================
   PRIVATE CHAT HISTORY
========================= */

app.get(
  "/api/messages/:userId",
  auth,
  async (req, res) => {

    try {
      const other =
        String(req.params.userId);

      const me =
        String(req.user.id);

      const result = await db(
        `
        SELECT
          m.id,
          m.sender_id,
          m.receiver_id,
          m.message,
          m.created_at,
          u.name AS sender_name
        FROM messages m
        LEFT JOIN users u
          ON CAST(u.id AS TEXT)=m.sender_id
        WHERE
          (
            m.sender_id=$1
            AND m.receiver_id=$2
          )
          OR
          (
            m.sender_id=$2
            AND m.receiver_id=$1
          )
        ORDER BY m.created_at ASC
        LIMIT 200
        `,
        [me, other]
      );

      res.json(result.rows);

    } catch (err) {
      console.error(
        "CHAT HISTORY ERROR:",
        err
      );

      res.status(500).json([]);
    }
  }
);

/* =========================
   CREATE CLUB
========================= */

app.post(
  "/api/clubs",
  auth,
  async (req, res) => {

    try {
      const name =
        String(
          req.body.name ||
          "Mullisa Club"
        ).trim();

      let code;

      for (let i = 0; i < 20; i++) {
        const possible =
          randomCode();

        const check = await db(
          `
          SELECT id
          FROM clubs
          WHERE club_code=$1
          LIMIT 1
          `,
          [possible]
        );

        if (!check.rows.length) {
          code = possible;
          break;
        }
      }

      if (!code) {
        return res.status(500).json({
          error:
            "Club code uumuu hin dandeenye."
        });
      }

      const result = await db(
        `
        INSERT INTO clubs
        (
          club_code,
          name,
          owner_id,
          locked
        )
        VALUES
        ($1,$2,$3,false)
        RETURNING *
        `,
        [
          code,
          name,
          String(req.user.id)
        ]
      );

      await db(
        `
        INSERT INTO club_members
        (
          club_id,
          user_id,
          role,
          mic_on
        )
        VALUES
        ($1,$2,'host',true)
        ON CONFLICT
        (club_id,user_id)
        DO NOTHING
        `,
        [
          result.rows[0].id,
          String(req.user.id)
        ]
      );

      res.json({
        ok: true,
        club: result.rows[0]
      });

    } catch (err) {
      console.error(
        "CREATE CLUB ERROR:",
        err
      );

      res.status(500).json({
        error:
          "Club uumuu hin dandeenye."
      });
    }
  }
);

/* =========================
   JOIN CLUB
========================= */

app.post(
  "/api/clubs/join",
  auth,
  async (req, res) => {

    try {
      const code =
        String(
          req.body.code || ""
        )
          .trim()
          .toUpperCase();

      if (!code) {
        return res.status(400).json({
          error:
            "Club code galchi."
        });
      }

      const result = await db(
        `
        SELECT *
        FROM clubs
        WHERE club_code=$1
        LIMIT 1
        `,
        [code]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error:
            "Club hin argamne."
        });
      }

      const club =
        result.rows[0];

      const me =
        String(req.user.id);

      const owner =
        String(club.owner_id);

      if (
        club.locked &&
        owner !== me
      ) {
        return res.status(403).json({
          error:
            "Club cufameera."
        });
      }

      const count =
        await db(
          `
          SELECT COUNT(*)::int AS count
          FROM club_members
          WHERE club_id=$1
          `,
          [club.id]
        );

      /*
        Total members 50.
        Speakers later keessatti 10
        daangessina.
      */

      if (
        Number(count.rows[0].count) >= 50 &&
        owner !== me
      ) {
        return res.status(400).json({
          error:
            "Club guuteera."
        });
      }

      const role =
        owner === me
          ? "host"
          : "listener";

      await db(
        `
        INSERT INTO club_members
        (
          club_id,
          user_id,
          role
        )
        VALUES
        ($1,$2,$3)
        ON CONFLICT
        (club_id,user_id)
        DO NOTHING
        `,
        [
          club.id,
          me,
          role
        ]
      );

      res.json({
        ok: true,
        club
      });

    } catch (err) {
      console.error(
        "JOIN CLUB ERROR:",
        err
      );

      res.status(500).json({
        error:
          "Club seenuu hin dandeenye."
      });
    }
  }
);

/* =========================
   CLUB MEMBERS
========================= */

app.get(
  "/api/clubs/:code/members",
  auth,
  async (req, res) => {

    try {
      const code =
        String(
          req.params.code
        ).toUpperCase();

      const result = await db(
        `
        SELECT
          cm.user_id,
          cm.role,
          cm.mic_on,
          cm.camera_on,
          cm.raised_hand,
          u.name,
          u.username,
          u.avatar
        FROM club_members cm
        JOIN clubs c
          ON c.id=cm.club_id
        JOIN users u
          ON CAST(u.id AS TEXT)=cm.user_id
        WHERE c.club_code=$1
        ORDER BY cm.joined_at
        `,
        [code]
      );

      res.json(result.rows);

    } catch (err) {
      console.error(
        "CLUB MEMBERS ERROR:",
        err
      );

      res.status(500).json([]);
    }
  }
);

/* =========================
   CLUB CHAT HISTORY
========================= */

app.get(
  "/api/clubs/:code/messages",
  auth,
  async (req, res) => {

    try {
      const code =
        String(
          req.params.code
        ).toUpperCase();

      const result = await db(
        `
        SELECT
          cm.id,
          cm.message,
          cm.created_at,
          cm.user_id,
          u.name,
          u.username
        FROM club_messages cm
        JOIN clubs c
          ON c.id=cm.club_id
        JOIN users u
          ON CAST(u.id AS TEXT)=cm.user_id
        WHERE c.club_code=$1
        ORDER BY cm.created_at ASC
        LIMIT 200
        `,
        [code]
      );

      res.json(result.rows);

    } catch (err) {
      console.error(
        "CLUB HISTORY ERROR:",
        err
      );

      res.status(500).json([]);
    }
  }
);

/* =========================
   SOCKET.IO
========================= */

const onlineUsers = new Map();

io.on("connection", socket => {

  console.log(
    "Socket connected:",
    socket.id
  );

  /* =====================
     USER ONLINE
  ===================== */

  socket.on(
    "user-online",
    userId => {

      if (!userId) return;

      const id =
        String(userId);

      onlineUsers.set(
        id,
        socket.id
      );

      socket.userId = id;

      io.emit(
        "user-status",
        {
          userId: id,
          online: true
        }
      );
    }
  );

  /* =====================
     PRIVATE MESSAGE
  ===================== */

  socket.on(
    "private-message",
    async data => {

      try {
        if (!socket.userId) return;

        const receiverId =
          String(
            data.receiverId || ""
          );

        const message =
          String(
            data.message || ""
          ).trim();

        if (
          !receiverId ||
          !message
        ) {
          return;
        }

        const result =
          await db(
            `
            INSERT INTO messages
            (
              sender_id,
              receiver_id,
              message
            )
            VALUES
            ($1,$2,$3)
            RETURNING
              id,
              sender_id,
              receiver_id,
              message,
              created_at
            `,
            [
              String(socket.userId),
              receiverId,
              message
            ]
          );

        const payload = {
          ...result.rows[0],
          senderName:
            data.senderName ||
            "User"
        };

        socket.emit(
          "private-message",
          payload
        );

        const target =
          onlineUsers.get(
            receiverId
          );

        if (target) {
          io.to(target).emit(
            "private-message",
            payload
          );
        }

      } catch (err) {
        console.error(
          "PRIVATE MESSAGE ERROR:",
          err
        );
      }
    }
  );

  /* =====================
     CALL USER
  ===================== */

  socket.on(
    "call-user",
    data => {

      const target =
        onlineUsers.get(
          String(data.userId)
        );

      if (!target) {
        socket.emit(
          "call-error",
          {
            message:
              "Namni kun online miti."
          }
        );

        return;
      }

      io.to(target).emit(
        "incoming-call",
        {
          fromUserId:
            socket.userId,

          fromName:
            data.fromName || "User",

          callType:
            data.callType || "audio",

          offer:
            data.offer
        }
      );
    }
  );

  /* =====================
     ANSWER CALL
  ===================== */

  socket.on(
    "answer-call",
    data => {

      const target =
        onlineUsers.get(
          String(data.toUserId)
        );

      if (!target) return;

      io.to(target).emit(
        "call-answered",
        {
          fromUserId:
            socket.userId,

          answer:
            data.answer
        }
      );
    }
  );

  /* =====================
     ICE
  ===================== */

  socket.on(
    "ice-candidate",
    data => {

      const target =
        onlineUsers.get(
          String(data.toUserId)
        );

      if (!target) return;

      io.to(target).emit(
        "ice-candidate",
        {
          fromUserId:
            socket.userId,

          candidate:
            data.candidate
        }
      );
    }
  );

  /* =====================
     END CALL
  ===================== */

  socket.on(
    "end-call",
    data => {

      const target =
        onlineUsers.get(
          String(data.toUserId)
        );

      if (!target) return;

      io.to(target).emit(
        "call-ended"
      );
    }
  );

  /* =====================
     JOIN CLUB ROOM
  ===================== */

  socket.on(
    "join-club-room",
    code => {

      const clubCode =
        String(code || "")
          .trim()
          .toUpperCase();

      if (!clubCode) return;

      socket.join(
        `club:${clubCode}`
      );
    }
  );

  /* =====================
     LEAVE CLUB ROOM
  ===================== */

  socket.on(
    "leave-club-room",
    code => {

      const clubCode =
        String(code || "")
          .trim()
          .toUpperCase();

      if (!clubCode) return;

      socket.leave(
        `club:${clubCode}`
      );
    }
  );

  /* =====================
     CLUB MESSAGE
  ===================== */

  socket.on(
    "club-message",
    async data => {

      try {
        if (!socket.userId) return;

        const code =
          String(data.code || "")
            .trim()
            .toUpperCase();

        const message =
          String(data.message || "")
            .trim();

        if (
          !code ||
          !message
        ) {
          return;
        }

        const club =
          await db(
            `
            SELECT
              id,
              locked
            FROM clubs
            WHERE club_code=$1
            LIMIT 1
            `,
            [code]
          );

        if (!club.rows.length) {
          return;
        }

        const clubId =
          club.rows[0].id;

        /*
          Check member
        */

        const member =
          await db(
            `
            SELECT id
            FROM club_members
            WHERE club_id=$1
              AND user_id=$2
            LIMIT 1
            `,
            [
              clubId,
              String(socket.userId)
            ]
          );

        if (!member.rows.length) {
          return;
        }

        const result =
          await db(
            `
            INSERT INTO club_messages
            (
              club_id,
              user_id,
              message
            )
            VALUES
            ($1,$2,$3)
            RETURNING
              id,
              message,
              created_at
            `,
            [
              clubId,
              String(socket.userId),
              message
            ]
          );

        const user =
          await db(
            `
            SELECT
              name,
              username
            FROM users
            WHERE CAST(id AS TEXT)=$1
            LIMIT 1
            `,
            [
              String(socket.userId)
            ]
          );

        io.to(
          `club:${code}`
        ).emit(
          "club-message",
          {
            ...result.rows[0],

            userId:
              String(socket.userId),

            name:
              user.rows[0]?.name ||
              "User",

            username:
              user.rows[0]?.username ||
              ""
          }
        );

      } catch (err) {
        console.error(
          "CLUB MESSAGE ERROR:",
          err
        );
      }
    }
  );

  /* =====================
     CLUB VOICE SIGNAL
  ===================== */

  socket.on(
    "club-voice-signal",
    data => {

      const code =
        String(data.code || "")
          .trim()
          .toUpperCase();

      if (!code) return;

      socket
        .to(`club:${code}`)
        .emit(
          "club-voice-signal",
          {
            fromUserId:
              socket.userId,

            signal:
              data.signal
          }
        );
    }
  );

  /* =====================
     CLUB ACTION
  ===================== */

  socket.on(
    "club-action",
    data => {

      const code =
        String(data.code || "")
          .trim()
          .toUpperCase();

      if (!code) return;

      socket
        .to(`club:${code}`)
        .emit(
          "club-action",
          {
            ...data,

            fromUserId:
              socket.userId
          }
        );
    }
  );

  /* =====================
     DISCONNECT
  ===================== */

  socket.on(
    "disconnect",
    () => {

      if (socket.userId) {

        const current =
          onlineUsers.get(
            socket.userId
          );

        if (
          current === socket.id
        ) {
          onlineUsers.delete(
            socket.userId
          );

          io.emit(
            "user-status",
            {
              userId:
                socket.userId,

              online: false
            }
          );
        }
      }

      console.log(
        "Socket disconnected:",
        socket.id
      );
    }
  );
});

/* =========================
   FRONTEND
========================= */

app.get("*", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

/* =========================
   START
========================= */

async function start() {

  try {

    await migrate();

    server.listen(
      PORT,
      "0.0.0.0",
      () => {

        console.log(
          `Mullisa-JM running on port ${PORT}`
        );

      }
    );

  } catch (err) {

    console.error(
      "Startup error:",
      err
    );

    process.exit(1);
  }
}

start();
