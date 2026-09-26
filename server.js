const express = require("express");
const http = require("http");
const path = require("path");
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

// ===============================
// MIDDLEWARE
// ===============================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Public folder
app.use(express.static(path.join(__dirname, "public")));

// ===============================
// DATA
// ===============================

const users = new Map();
const rooms = new Map();
const classes = new Map();

// ===============================
// HOME
// ===============================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ===============================
// HEALTH CHECK
// ===============================

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    app: "Mullisa-JM",
    status: "online",
    time: new Date().toISOString()
  });
});

// ===============================
// USER LOGIN
// ===============================

app.post("/api/login", (req, res) => {

  const username = String(req.body.username || "").trim();

  if (!username) {
    return res.status(400).json({
      success: false,
      message: "Maqaa galchi."
    });
  }

  const userId =
    Date.now().toString() +
    Math.random().toString(36).substring(2, 8);

  const user = {
    id: userId,
    username,
    online: true,
    createdAt: new Date()
  };

  users.set(userId, user);

  res.json({
    success: true,
    user
  });
});

// ===============================
// USERS
// ===============================

app.get("/api/users", (req, res) => {

  res.json({
    success: true,
    users: Array.from(users.values())
  });

});

// ===============================
// CREATE CLASS
// ===============================

app.post("/api/classes", (req, res) => {

  const ownerName =
    String(req.body.ownerName || "Host").trim();

  const classId =
    "CLS-" +
    Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();

  const newClass = {
    id: classId,
    name: req.body.name || "Mullisa-JM Kilaasii",
    ownerName,
    maxSeats: 10,

    seats: [
      {
        seat: 1,
        username: ownerName,
        role: "host"
      }
    ],

    audience: [],

    createdAt: new Date()
  };

  classes.set(classId, newClass);

  res.json({
    success: true,
    class: newClass
  });

});

// ===============================
// GET CLASSES
// ===============================

app.get("/api/classes", (req, res) => {

  res.json({
    success: true,
    classes: Array.from(classes.values())
  });

});

// ===============================
// GET ONE CLASS
// ===============================

app.get("/api/classes/:id", (req, res) => {

  const classroom = classes.get(req.params.id);

  if (!classroom) {
    return res.status(404).json({
      success: false,
      message: "Kilaasiin hin argamne."
    });
  }

  res.json({
    success: true,
    class: classroom
  });

});

// ===============================
// JOIN CLASS
// ===============================

app.post("/api/classes/:id/join", (req, res) => {

  const classroom = classes.get(req.params.id);

  if (!classroom) {
    return res.status(404).json({
      success: false,
      message: "Kilaasiin hin argamne."
    });
  }

  const username =
    String(req.body.username || "").trim();

  if (!username) {
    return res.status(400).json({
      success: false,
      message: "Maqaa galchi."
    });
  }

  // Already inside seat
  const alreadySeat = classroom.seats.find(
    s => s.username === username
  );

  if (alreadySeat) {
    return res.json({
      success: true,
      type: "seat",
      seat: alreadySeat.seat,
      class: classroom
    });
  }

  // Already audience
  if (classroom.audience.includes(username)) {

    return res.json({
      success: true,
      type: "audience",
      class: classroom
    });

  }

  // Find free seat
  if (classroom.seats.length < classroom.maxSeats) {

    const usedSeats =
      classroom.seats.map(s => s.seat);

    let freeSeat = null;

    for (let i = 1; i <= 10; i++) {

      if (!usedSeats.includes(i)) {
        freeSeat = i;
        break;
      }

    }

    classroom.seats.push({
      seat: freeSeat,
      username,
      role: "student"
    });

    io.to(`class:${classroom.id}`).emit(
      "classUpdated",
      classroom
    );

    return res.json({
      success: true,
      type: "seat",
      seat: freeSeat,
      class: classroom
    });
  }

  // No seat = audience
  classroom.audience.push(username);

  io.to(`class:${classroom.id}`).emit(
    "classUpdated",
    classroom
  );

  res.json({
    success: true,
    type: "audience",
    class: classroom
  });

});

// ===============================
// LEAVE CLASS
// ===============================

app.post("/api/classes/:id/leave", (req, res) => {

  const classroom = classes.get(req.params.id);

  if (!classroom) {
    return res.status(404).json({
      success: false,
      message: "Kilaasiin hin argamne."
    });
  }

  const username =
    String(req.body.username || "").trim();

  classroom.seats =
    classroom.seats.filter(
      seat => seat.username !== username
    );

  classroom.audience =
    classroom.audience.filter(
      name => name !== username
    );

  io.to(`class:${classroom.id}`).emit(
    "classUpdated",
    classroom
  );

  res.json({
    success: true,
    class: classroom
  });

});

// ===============================
// CREATE ROOM
// ===============================

app.post("/api/rooms", (req, res) => {

  const roomId =
    "ROOM-" +
    Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();

  const room = {
    id: roomId,
    name: req.body.name || "Mullisa-JM Room",
    owner:
      req.body.username || "Host",
    users: [],
    createdAt: new Date()
  };

  rooms.set(roomId, room);

  res.json({
    success: true,
    room
  });

});

// ===============================
// GET ROOMS
// ===============================

app.get("/api/rooms", (req, res) => {

  res.json({
    success: true,
    rooms: Array.from(rooms.values())
  });

});

// ===============================
// SOCKET.IO
// ===============================

io.on("connection", (socket) => {

  console.log("🟢 User connected:", socket.id);

  // -----------------------------
  // USER ONLINE
  // -----------------------------

  socket.on("userOnline", (user) => {

    if (!user || !user.username) return;

    socket.username = user.username;

    socket.userId = user.id || socket.id;

    users.set(socket.userId, {
      id: socket.userId,
      username: user.username,
      online: true
    });

    io.emit("usersUpdated", Array.from(users.values()));

  });

  // -----------------------------
  // JOIN CLASS
  // -----------------------------

  socket.on("joinClass", (data) => {

    if (!data || !data.classId) return;

    const classroom = classes.get(data.classId);

    if (!classroom) {
      socket.emit("errorMessage", {
        message: "Kilaasiin hin argamne."
      });

      return;
    }

    socket.join(`class:${data.classId}`);

    socket.classId = data.classId;

    socket.emit("classJoined", classroom);

    socket.to(`class:${data.classId}`).emit(
      "userJoinedClass",
      {
        username: data.username,
        classId: data.classId
      }
    );

  });

  // -----------------------------
  // LEAVE CLASS
  // -----------------------------

  socket.on("leaveClass", () => {

    if (!socket.classId) return;

    socket.leave(`class:${socket.classId}`);

    socket.to(`class:${socket.classId}`).emit(
      "userLeftClass",
      {
        username: socket.username
      }
    );

    socket.classId = null;

  });

  // -----------------------------
  // CLASS CHAT
  // -----------------------------

  socket.on("classMessage", (message) => {

    if (!socket.classId) return;

    io.to(`class:${socket.classId}`).emit(
      "classMessage",
      {
        username: socket.username || "User",
        message,
        time: new Date().toISOString()
      }
    );

  });

  // -----------------------------
  // PRIVATE CHAT
  // -----------------------------

  socket.on("privateMessage", (data) => {

    if (!data || !data.to) return;

    io.to(data.to).emit(
      "privateMessage",
      {
        from: socket.username || "User",
        message: data.message,
        time: new Date().toISOString()
      }
    );

  });

  // -----------------------------
  // ROOM JOIN
  // -----------------------------

  socket.on("joinRoom", (data) => {

    if (!data || !data.roomId) return;

    const room = rooms.get(data.roomId);

    if (!room) {

      socket.emit("errorMessage", {
        message: "Room hin argamne."
      });

      return;
    }

    socket.join(`room:${data.roomId}`);

    socket.roomId = data.roomId;

    if (!room.users.includes(socket.id)) {
      room.users.push(socket.id);
    }

    io.to(`room:${data.roomId}`).emit(
      "roomUsers",
      room.users
    );

  });

  // -----------------------------
  // WEBRTC SIGNAL
  // -----------------------------

  socket.on("offer", (data) => {

    if (!data || !data.to) return;

    io.to(data.to).emit("offer", {
      from: socket.id,
      offer: data.offer
    });

  });

  socket.on("answer", (data) => {

    if (!data || !data.to) return;

    io.to(data.to).emit("answer", {
      from: socket.id,
      answer: data.answer
    });

  });

  socket.on("ice-candidate", (data) => {

    if (!data || !data.to) return;

    io.to(data.to).emit("ice-candidate", {
      from: socket.id,
      candidate: data.candidate
    });

  });

  // -----------------------------
  // MIC
  // -----------------------------

  socket.on("micStatus", (status) => {

    if (!socket.classId) return;

    socket.to(`class:${socket.classId}`).emit(
      "micStatus",
      {
        username: socket.username,
        status
      }
    );

  });

  // -----------------------------
  // CAMERA
  // -----------------------------

  socket.on("cameraStatus", (status) => {

    if (!socket.roomId) return;

    socket.to(`room:${socket.roomId}`).emit(
      "cameraStatus",
      {
        username: socket.username,
        status
      }
    );

  });

  // -----------------------------
  // DISCONNECT
  // -----------------------------

  socket.on("disconnect", () => {

    console.log("🔴 User disconnected:", socket.id);

    if (socket.userId) {

      const user = users.get(socket.userId);

      if (user) {
        user.online = false;
        users.set(socket.userId, user);
      }

      io.emit(
        "usersUpdated",
        Array.from(users.values())
      );
    }

    if (socket.roomId) {

      const room = rooms.get(socket.roomId);

      if (room) {

        room.users =
          room.users.filter(
            id => id !== socket.id
          );

        io.to(`room:${socket.roomId}`).emit(
          "roomUsers",
          room.users
        );

      }

    }

  });

});

// ===============================
// START SERVER
// ===============================

server.listen(PORT, "0.0.0.0", () => {

  console.log("=================================");
  console.log("🟢 MULLISA-JM SERVER");
  console.log("=================================");
  console.log(`🚀 Port: ${PORT}`);
  console.log("📡 Socket.IO: ON");
  console.log("👥 Class seats: 10");
  console.log("🎥 Rooms: ON");
  console.log("💬 Chat: ON");
  console.log("📞 Call signaling: ON");
  console.log("=================================");

});
