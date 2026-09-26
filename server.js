const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
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

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   DATA
========================= */

const users = new Map();
const rooms = new Map();
const follows = new Map();

/* =========================
   API STATUS
========================= */

app.get("/api/status", (req, res) => {
  res.json({
    app: "Mullisa-JM",
    status: "online",
    users: users.size,
    rooms: rooms.size,
    time: new Date().toISOString()
  });
});

/* =========================
   ALL USERS
========================= */

app.get("/api/users", (req, res) => {
  res.json(
    Array.from(users.values()).map(user => ({
      id: user.id,
      username: user.username,
      online: true
    }))
  );
});

/* =========================
   SOCKET.IO
========================= */

io.on("connection", socket => {

  console.log("User connected:", socket.id);

  /* =========================
     LOGIN
  ========================= */

  socket.on("login", data => {

    const username = String(
      data?.username || ""
    ).trim();

    if (!username) {
      socket.emit(
        "login-error",
        "Maqaa kee galchi."
      );
      return;
    }

    const user = {
      id: socket.id,
      username,
      online: true,
      followers: 0,
      following: 0,
      createdAt: Date.now()
    };

    users.set(socket.id, user);

    socket.username = username;

    socket.emit("login-success", user);

    broadcastUsers();
  });

  /* =========================
     GET PROFILE
  ========================= */

  socket.on("get-profile", userId => {

    const user = users.get(userId);

    if (!user) {
      socket.emit(
        "profile-error",
        "User hin argamne."
      );
      return;
    }

    socket.emit("profile-data", user);
  });

  /* =========================
     FOLLOW USER
  ========================= */

  socket.on("follow-user", data => {

    const targetId = data?.targetId;

    if (!targetId) return;

    const target = users.get(targetId);

    if (!target) {
      socket.emit(
        "follow-error",
        "User hin argamne."
      );
      return;
    }

    if (targetId === socket.id) {
      socket.emit(
        "follow-error",
        "Ofii kee follow gochuu hin dandeessu."
      );
      return;
    }

    if (!follows.has(socket.id)) {
      follows.set(socket.id, new Set());
    }

    const following = follows.get(socket.id);

    if (following.has(targetId)) {
      following.delete(targetId);

      target.followers =
        Math.max(0, target.followers - 1);

      socket.emit("follow-status", {
        following: false,
        targetId
      });

    } else {

      following.add(targetId);

      target.followers += 1;

      socket.emit("follow-status", {
        following: true,
        targetId
      });
    }

    updateFollowingCount(socket.id);
    broadcastUsers();
  });

  /* =========================
     CREATE ROOM
  ========================= */

  socket.on("create-room", data => {

    const roomName = String(
      data?.roomName || ""
    ).trim();

    const seats = Number(data?.seats) || 10;

    if (!roomName) {
      socket.emit(
        "room-error",
        "Maqaa Room galchi."
      );
      return;
    }

    const roomId =
      crypto
        .randomBytes(3)
        .toString("hex")
        .toUpperCase();

    const room = {
      id: roomId,
      name: roomName,
      owner: socket.username || "Guest",
      ownerId: socket.id,

      /* Teessoo */
      totalSeats: seats === 15 ? 15 : 10,

      topSeats: [],
      bottomSeats: [],

      /* Audience */
      audience: [],

      /* Members */
      members: [],

      locked: false,

      createdAt: Date.now()
    };

    rooms.set(roomId, room);

    socket.emit(
      "room-created",
      room
    );
  });

  /* =========================
     JOIN ROOM
  ========================= */

  socket.on("join-room", roomId => {

    roomId = String(
      roomId || ""
    ).trim().toUpperCase();

    const room = rooms.get(roomId);

    if (!room) {
      socket.emit(
        "room-error",
        "Room hin argamne."
      );
      return;
    }

    socket.join(roomId);

    socket.roomId = roomId;

    const username =
      socket.username || "Guest";

    if (!room.members.includes(username)) {
      room.members.push(username);
    }

    /*
      Owner / Host
      Teessoo 1 irratti kaa'a
    */

    if (
      socket.id === room.ownerId &&
      !room.topSeats.includes(username)
    ) {
      room.topSeats.push(username);
    }

    /*
      Namoonni hafan audience
    */

    if (
      !room.topSeats.includes(username) &&
      !room.bottomSeats.includes(username) &&
      !room.audience.includes(username)
    ) {
      room.audience.push(username);
    }

    io.to(roomId).emit(
      "room-updated",
      room
    );

    socket.emit(
      "joined-room",
      room
    );
  });

  /* =========================
     LEAVE ROOM
  ========================= */

  socket.on("leave-room", () => {

    leaveCurrentRoom(socket);
  });

  /* =========================
     REQUEST SEAT
  ========================= */

  socket.on("request-seat", () => {

    const room = rooms.get(
      socket.roomId
    );

    if (!room) return;

    const username =
      socket.username || "Guest";

    if (
      room.topSeats.includes(username) ||
      room.bottomSeats.includes(username)
    ) {
      return;
    }

    socket.emit(
      "seat-request-sent",
      {
        roomId: room.id,
        username
      }
    );

    io.to(room.ownerId).emit(
      "seat-request",
      {
        username,
        userId: socket.id
      }
    );
  });

  /* =========================
     PROMOTE TO SEAT
  ========================= */

  socket.on("promote-user", data => {

    const room = rooms.get(
      socket.roomId
    );

    if (!room) return;

    if (socket.id !== room.ownerId) {
      return;
    }

    const targetId = data?.userId;

    const targetSocket =
      io.sockets.sockets.get(targetId);

    if (!targetSocket) return;

    const username =
      targetSocket.username;

    const occupied =
      room.topSeats.length +
      room.bottomSeats.length;

    if (occupied >= room.totalSeats) {

      socket.emit(
        "room-error",
        "Teessoon hundi guuteera."
      );

      return;
    }

    room.audience =
      room.audience.filter(
        name => name !== username
      );

    room.bottomSeats.push(username);

    io.to(room.id).emit(
      "room-updated",
      room
    );
  });

  /* =========================
     DEMOTE TO AUDIENCE
  ========================= */

  socket.on("demote-user", data => {

    const room = rooms.get(
      socket.roomId
    );

    if (!room) return;

    if (socket.id !== room.ownerId) {
      return;
    }

    const username =
      data?.username;

    room.topSeats =
      room.topSeats.filter(
        name => name !== username
      );

    room.bottomSeats =
      room.bottomSeats.filter(
        name => name !== username
      );

    if (
      username &&
      !room.audience.includes(username)
    ) {
      room.audience.push(username);
    }

    io.to(room.id).emit(
      "room-updated",
      room
    );
  });

  /* =========================
     LOCK / UNLOCK ROOM
  ========================= */

  socket.on("toggle-room-lock", () => {

    const room = rooms.get(
      socket.roomId
    );

    if (!room) return;

    if (socket.id !== room.ownerId) {
      return;
    }

    room.locked = !room.locked;

    io.to(room.id).emit(
      "room-updated",
      room
    );
  });

  /* =========================
     ROOM CHAT
  ========================= */

  socket.on("room-message", message => {

    if (!socket.roomId) return;

    const text =
      String(message || "").trim();

    if (!text) return;

    io.to(socket.roomId).emit(
      "room-message",
      {
        username:
          socket.username || "Guest",

        message: text,

        time:
          new Date().toLocaleTimeString()
      }
    );
  });

  /* =========================
     PRIVATE CHAT
  ========================= */

  socket.on("private-message", data => {

    const targetId = data?.to;

    const message =
      String(data?.message || "").trim();

    if (!targetId || !message) return;

    io.to(targetId).emit(
      "private-message",
      {
        from: socket.id,
        username:
          socket.username || "Guest",
        message,
        time:
          new Date().toLocaleTimeString()
      }
    );
  });

  /* =========================
     CALL
  ========================= */

  socket.on("call-user", data => {

    if (!data?.to) return;

    io.to(data.to).emit(
      "incoming-call",
      {
        from: socket.id,
        username:
          socket.username || "Guest",
        offer: data.offer,
        type: data.type || "voice"
      }
    );
  });

  /* =========================
     ANSWER CALL
  ========================= */

  socket.on("answer-call", data => {

    if (!data?.to) return;

    io.to(data.to).emit(
      "call-answered",
      {
        from: socket.id,
        answer: data.answer
      }
    );
  });

  /* =========================
     REJECT CALL
  ========================= */

  socket.on("reject-call", data => {

    if (!data?.to) return;

    io.to(data.to).emit(
      "call-rejected",
      {
        from: socket.id
      }
    );
  });

  /* =========================
     END CALL
  ========================= */

  socket.on("end-call", data => {

    if (!data?.to) return;

    io.to(data.to).emit(
      "call-ended",
      {
        from: socket.id
      }
    );
  });

  /* =========================
     WEBRTC ICE
  ========================= */

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

  /* =========================
     MIC STATUS
  ========================= */

  socket.on("mic-status", enabled => {

    if (!socket.roomId) return;

    socket.to(socket.roomId).emit(
      "user-mic-status",
      {
        userId: socket.id,
        username:
          socket.username || "Guest",
        enabled: Boolean(enabled)
      }
    );
  });

  /* =========================
     CAMERA STATUS
  ========================= */

  socket.on("camera-status", enabled => {

    if (!socket.roomId) return;

    socket.to(socket.roomId).emit(
      "user-camera-status",
      {
        userId: socket.id,
        username:
          socket.username || "Guest",
        enabled: Boolean(enabled)
      }
    );
  });

  /* =========================
     REMOVE USER FROM ROOM
  ========================= */

  socket.on("remove-user", data => {

    const room = rooms.get(
      socket.roomId
    );

    if (!room) return;

    if (socket.id !== room.ownerId) {
      return;
    }

    const targetId = data?.userId;

    const targetSocket =
      io.sockets.sockets.get(targetId);

    if (!targetSocket) return;

    if (
      targetSocket.roomId !== room.id
    ) {
      return;
    }

    targetSocket.leave(room.id);

    targetSocket.roomId = null;

    removeUserFromRoom(
      room,
      targetSocket.username
    );

    targetSocket.emit(
      "removed-from-room"
    );

    io.to(room.id).emit(
      "room-updated",
      room
    );
  });

  /* =========================
     DISCONNECT
  ========================= */

  socket.on("disconnect", () => {

    console.log(
      "User disconnected:",
      socket.id
    );

    leaveCurrentRoom(socket);

    users.delete(socket.id);

    follows.delete(socket.id);

    /*
      Followers keessaa user kana haq
    */

    for (const set of follows.values()) {
      set.delete(socket.id);
    }

    broadcastUsers();
  });
});

/* =========================
   FUNCTIONS
========================= */

function broadcastUsers() {

  io.emit(
    "online-users",
    Array.from(
      users.values()
    )
  );
}

function updateFollowingCount(userId) {

  const user =
    users.get(userId);

  if (!user) return;

  const following =
    follows.get(userId);

  user.following =
    following
      ? following.size
      : 0;
}

function removeUserFromRoom(
  room,
  username
) {

  room.members =
    room.members.filter(
      name => name !== username
    );

  room.topSeats =
    room.topSeats.filter(
      name => name !== username
    );

  room.bottomSeats =
    room.bottomSeats.filter(
      name => name !== username
    );

  room.audience =
    room.audience.filter(
      name => name !== username
    );
}

function leaveCurrentRoom(socket) {

  if (!socket.roomId) {
    return;
  }

  const roomId =
    socket.roomId;

  const room =
    rooms.get(roomId);

  if (room) {

    removeUserFromRoom(
      room,
      socket.username
    );

    io.to(roomId).emit(
      "room-updated",
      room
    );

    /*
      Room owner yoo bahe,
      room cufu
    */

    if (
      socket.id === room.ownerId
    ) {

      io.to(roomId).emit(
        "room-closed"
      );

      rooms.delete(roomId);
    }
  }

  socket.leave(roomId);

  socket.roomId = null;
}

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
   START SERVER
========================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Mullisa-JM running on port ${PORT}`
    );
  }
);
