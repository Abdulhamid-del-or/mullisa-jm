const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 10000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_URL ykn SUPABASE_SERVICE_ROLE_KEY hin argamne.");
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));


// ======================================
// HOME
// ======================================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


// ======================================
// HEALTH
// ======================================

app.get("/api/health", async (req, res) => {

  const { error } = await supabase
    .from("users")
    .select("id")
    .limit(1);

  res.json({
    success: !error,
    app: "Mullisa-JM",
    database: error ? "error" : "connected",
    time: new Date().toISOString()
  });
});


// ======================================
// REGISTER / LOGIN
// ======================================

app.post("/api/login", async (req, res) => {

  try {

    const username = String(
      req.body.username || ""
    ).trim();

    if (!username) {
      return res.status(400).json({
        success: false,
        message: "Maqaa galchi."
      });
    }

    let { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("username", username)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!user) {

      const { data: newUser, error: insertError } =
        await supabase
          .from("users")
          .insert({
            username: username,
            online: true
          })
          .select()
          .single();

      if (insertError) {
        throw insertError;
      }

      user = newUser;

    } else {

      const { data: updatedUser, error: updateError } =
        await supabase
          .from("users")
          .update({
            online: true
          })
          .eq("id", user.id)
          .select()
          .single();

      if (!updateError && updatedUser) {
        user = updatedUser;
      }

    }

    res.json({
      success: true,
      user
    });

  } catch (error) {

    console.error("LOGIN ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Login irratti rakkoon uumame."
    });

  }

});


// ======================================
// USERS
// ======================================

app.get("/api/users", async (req, res) => {

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .order("username");

  if (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }

  res.json({
    success: true,
    users: data
  });

});


// ======================================
// CREATE CLASS
// ======================================

app.post("/api/classes", async (req, res) => {

  try {

    const ownerName =
      String(req.body.ownerName || "Host").trim();

    const name =
      String(
        req.body.name ||
        "Mullisa-JM Kilaasii"
      ).trim();

    const classId =
      "CLS-" +
      Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase();

    const { data: classroom, error } =
      await supabase
        .from("classes")
        .insert({
          class_id: classId,
          name: name,
          owner_name: ownerName,
          max_seats: 10
        })
        .select()
        .single();

    if (error) {
      throw error;
    }

    const { error: seatError } =
      await supabase
        .from("class_seats")
        .insert({
          class_id: classroom.id,
          seat_number: 1,
          username: ownerName,
          role: "host"
        });

    if (seatError) {
      throw seatError;
    }

    res.json({
      success: true,
      class: classroom
    });

  } catch (error) {

    console.error("CREATE CLASS ERROR:", error);

    res.status(500).json({
      success: false,
      message: error.message
    });

  }

});


// ======================================
// GET CLASSES
// ======================================

app.get("/api/classes", async (req, res) => {

  const { data, error } = await supabase
    .from("classes")
    .select(`
      *,
      class_seats (*)
    `)
    .order("created_at", {
      ascending: false
    });

  if (error) {

    return res.status(500).json({
      success: false,
      message: error.message
    });

  }

  res.json({
    success: true,
    classes: data
  });

});


// ======================================
// GET ONE CLASS
// ======================================

app.get("/api/classes/:id", async (req, res) => {

  const { data, error } = await supabase
    .from("classes")
    .select(`
      *,
      class_seats (*)
    `)
    .eq("class_id", req.params.id)
    .single();

  if (error) {

    return res.status(404).json({
      success: false,
      message: "Kilaasiin hin argamne."
    });

  }

  res.json({
    success: true,
    class: data
  });

});


// ======================================
// JOIN CLASS
// ======================================

app.post("/api/classes/:id/join", async (req, res) => {

  try {

    const username =
      String(req.body.username || "").trim();

    if (!username) {
      return res.status(400).json({
        success: false,
        message: "Maqaa galchi."
      });
    }

    const { data: classroom, error } =
      await supabase
        .from("classes")
        .select("*")
        .eq("class_id", req.params.id)
        .single();

    if (error || !classroom) {
      return res.status(404).json({
        success: false,
        message: "Kilaasiin hin argamne."
      });
    }


    // Check existing seat
    const { data: existingSeat } =
      await supabase
        .from("class_seats")
        .select("*")
        .eq("class_id", classroom.id)
        .eq("username", username)
        .maybeSingle();

    if (existingSeat) {

      return res.json({
        success: true,
        type: "seat",
        seat: existingSeat.seat_number
      });

    }


    // Get seats
    const { data: seats } =
      await supabase
        .from("class_seats")
        .select("*")
        .eq("class_id", classroom.id)
        .order("seat_number");


    // Find free seat
    let freeSeat = null;

    for (let i = 1; i <= 10; i++) {

      const used =
        seats.some(
          seat => seat.seat_number === i
        );

      if (!used) {
        freeSeat = i;
        break;
      }

    }


    // Seat available
    if (freeSeat) {

      const { error: seatError } =
        await supabase
          .from("class_seats")
          .insert({
            class_id: classroom.id,
            seat_number: freeSeat,
            username,
            role: "student"
          });

      if (seatError) {
        throw seatError;
      }

      io.to(`class:${classroom.id}`)
        .emit("classUpdated");

      return res.json({
        success: true,
        type: "seat",
        seat: freeSeat
      });

    }


    // No seat = audience
    const { error: audienceError } =
      await supabase
        .from("class_audience")
        .insert({
          class_id: classroom.id,
          username
        });

    if (audienceError) {
      throw audienceError;
    }

    io.to(`class:${classroom.id}`)
      .emit("classUpdated");

    res.json({
      success: true,
      type: "audience"
    });

  } catch (error) {

    console.error("JOIN CLASS ERROR:", error);

    res.status(500).json({
      success: false,
      message: error.message
    });

  }

});


// ======================================
// LEAVE CLASS
// ======================================

app.post("/api/classes/:id/leave", async (req, res) => {

  try {

    const username =
      String(req.body.username || "").trim();

    const { data: classroom } =
      await supabase
        .from("classes")
        .select("id")
        .eq("class_id", req.params.id)
        .single();

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: "Kilaasiin hin argamne."
      });
    }


    await supabase
      .from("class_seats")
      .delete()
      .eq("class_id", classroom.id)
      .eq("username", username);


    await supabase
      .from("class_audience")
      .delete()
      .eq("class_id", classroom.id)
      .eq("username", username);


    io.to(`class:${classroom.id}`)
      .emit("classUpdated");

    res.json({
      success: true
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message
    });

  }

});


// ======================================
// CREATE ROOM
// ======================================

app.post("/api/rooms", async (req, res) => {

  try {

    const roomId =
      "ROOM-" +
      Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase();

    const { data: room, error } =
      await supabase
        .from("rooms")
        .insert({
          room_id: roomId,
          name:
            req.body.name ||
            "Mullisa-JM Room",
          owner:
            req.body.username ||
            "Host"
        })
        .select()
        .single();

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      room
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message
    });

  }

});


// ======================================
// GET ROOMS
// ======================================

app.get("/api/rooms", async (req, res) => {

  const { data, error } =
    await supabase
      .from("rooms")
      .select("*")
      .order("created_at", {
        ascending: false
      });

  if (error) {

    return res.status(500).json({
      success: false,
      message: error.message
    });

  }

  res.json({
    success: true,
    rooms: data
  });

});


// ======================================
// SOCKET.IO
// ======================================

io.on("connection", (socket) => {

  console.log("🟢 Connected:", socket.id);


  socket.on("userOnline", async (user) => {

    if (!user || !user.username) return;

    socket.username = user.username;

    if (user.id) {

      await supabase
        .from("users")
        .update({
          online: true
        })
        .eq("id", user.id);

    }

    io.emit("usersUpdated");

  });


  // ====================================
  // JOIN CLASS SOCKET
  // ====================================

  socket.on("joinClass", async (data) => {

    if (!data || !data.classId) return;

    const { data: classroom } =
      await supabase
        .from("classes")
        .select("id")
        .eq("class_id", data.classId)
        .single();

    if (!classroom) {

      socket.emit("errorMessage", {
        message: "Kilaasiin hin argamne."
      });

      return;
    }

    socket.join(`class:${classroom.id}`);

    socket.classId = classroom.id;

    socket.to(`class:${classroom.id}`)
      .emit("userJoinedClass", {
        username: data.username
      });

  });


  // ====================================
  // CLASS CHAT
  // ====================================

  socket.on("classMessage", (message) => {

    if (!socket.classId) return;

    io.to(`class:${socket.classId}`)
      .emit("classMessage", {
        username:
          socket.username || "User",
        message,
        time:
          new Date().toISOString()
      });

  });


  // ====================================
  // PRIVATE CHAT
  // ====================================

  socket.on("privateMessage", (data) => {

    if (!data || !data.to) return;

    io.to(data.to)
      .emit("privateMessage", {
        from:
          socket.username || "User",
        message: data.message,
        time:
          new Date().toISOString()
      });

  });


  // ====================================
  // ROOM
  // ====================================

  socket.on("joinRoom", (data) => {

    if (!data || !data.roomId) return;

    socket.join(`room:${data.roomId}`);

    socket.roomId = data.roomId;

    io.to(`room:${data.roomId}`)
      .emit("roomUserJoined", {
        username:
          socket.username || "User"
      });

  });


  // ====================================
  // WEBRTC
  // ====================================

  socket.on("offer", (data) => {

    if (!data?.to) return;

    io.to(data.to).emit("offer", {
      from: socket.id,
      offer: data.offer
    });

  });


  socket.on("answer", (data) => {

    if (!data?.to) return;

    io.to(data.to).emit("answer", {
      from: socket.id,
      answer: data.answer
    });

  });


  socket.on("ice-candidate", (data) => {

    if (!data?.to) return;

    io.to(data.to).emit(
      "ice-candidate",
      {
        from: socket.id,
        candidate: data.candidate
      }
    );

  });


  // ====================================
  // MIC
  // ====================================

  socket.on("micStatus", (status) => {

    if (!socket.classId) return;

    socket.to(`class:${socket.classId}`)
      .emit("micStatus", {
        username:
          socket.username || "User",
        status
      });

  });


  // ====================================
  // CAMERA
  // ====================================

  socket.on("cameraStatus", (status) => {

    if (!socket.roomId) return;

    socket.to(`room:${socket.roomId}`)
      .emit("cameraStatus", {
        username:
          socket.username || "User",
        status
      });

  });


  // ====================================
  // DISCONNECT
  // ====================================

  socket.on("disconnect", async () => {

    console.log("🔴 Disconnected:", socket.id);

    if (socket.username) {

      await supabase
        .from("users")
        .update({
          online: false
        })
        .eq("username", socket.username);

    }

  });

});


// ======================================
// START
// ======================================

server.listen(PORT, "0.0.0.0", () => {

  console.log("================================");
  console.log("🟢 MULLISA-JM SERVER");
  console.log("================================");
  console.log("🚀 Port:", PORT);
  console.log("📡 Socket.IO: ON");
  console.log("🗄️ Supabase: ON");
  console.log("👥 Class seats: 10");
  console.log("🎥 Rooms: ON");
  console.log("💬 Chat: ON");
  console.log("📞 Call signaling: ON");
  console.log("================================");

});
