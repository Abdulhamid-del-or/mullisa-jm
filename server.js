const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const users = new Map();
const rooms = new Map();

app.get("/api/status", (req, res) => {
  res.json({
    app: "Mullisa-JM",
    status: "online",
    users: users.size,
    rooms: rooms.size
  });
});

io.on("connection", (socket) => {

  socket.on("login", (user) => {
    const username = String(user?.username || "").trim();

    if (!username) return;

    users.set(socket.id, {
      id: socket.id,
      username
    });

    socket.username = username;

    socket.emit("login-success", {
      id: socket.id,
      username
    });

    io.emit("online-users", Array.from(users.values()));
  });

  socket.on("create-room", (data) => {
    const roomName = String(data?.roomName || "").trim();

    if (!roomName) return;

    const roomId =
      Math.random().toString(36).substring(2, 8).toUpperCase();

    rooms.set(roomId, {
      id: roomId,
      name: roomName,
      owner: socket.username || "Guest",
      members: []
    });

    socket.emit("room-created", rooms.get(roomId));
  });

  socket.on("join-room", (roomId) => {
    roomId = String(roomId || "").toUpperCase();

    const room = rooms.get(roomId);

    if (!room) {
      socket.emit("room-error", "Room hin argamne.");
      return;
    }

    socket.join(roomId);

    if (!room.members.includes(socket.username)) {
      room.members.push(socket.username);
    }

    socket.roomId = roomId;

    io.to(roomId).emit("room-users", room.members);

    socket.emit("joined-room", room);
  });

  socket.on("room-message", (message) => {
    if (!socket.roomId) return;

    io.to(socket.roomId).emit("room-message", {
      username: socket.username || "Guest",
      message: String(message || ""),
      time: new Date().toLocaleTimeString()
    });
  });

  socket.on("call-user", (data) => {
    io.to(data.to).emit("incoming-call", {
      from: socket.id,
      username: socket.username || "Guest",
      offer: data.offer
    });
  });

  socket.on("answer-call", (data) => {
    io.to(data.to).emit("call-answered", {
      from: socket.id,
      answer: data.answer
    });
  });

  socket.on("ice-candidate", (data) => {
    io.to(data.to).emit("ice-candidate", {
      from: socket.id,
      candidate: data.candidate
    });
  });

  socket.on("disconnect", () => {
    if (socket.roomId) {
      const room = rooms.get(socket.roomId);

      if (room) {
        room.members = room.members.filter(
          name => name !== socket.username
        );

        io.to(socket.roomId).emit(
          "room-users",
          room.members
        );
      }
    }

    users.delete(socket.id);

    io.emit(
      "online-users",
      Array.from(users.values())
    );
  });
});

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mullisa-JM running on port ${PORT}`);
});
