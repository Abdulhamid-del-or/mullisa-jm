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
    methods: ["GET", "POST", "PATCH", "DELETE"]
  }
});

const PORT = process.env.PORT || 10000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "❌ SUPABASE_URL ykn SUPABASE_SERVICE_ROLE_KEY hin argamne."
  );
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));


/* =====================================================
   HOME
===================================================== */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});


/* =====================================================
   HEALTH
===================================================== */

app.get("/api/health", async (req, res) => {
  try {
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

  } catch (error) {
    res.status(500).json({
      success: false,
      app: "Mullisa-JM",
      database: "error",
      message: error.message
    });
  }
});


/* =====================================================
   LOGIN / REGISTER
===================================================== */

app.post("/api/login", async (req, res) => {
  try {
    const username =
      String(req.body.username || "").trim();

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

    if (error) throw error;

    if (!user) {
      const { data: newUser, error: insertError } =
        await supabase
          .from("users")
          .insert({
            username,
            online: true
          })
          .select()
          .single();

      if (insertError) throw insertError;

      user = newUser;

    } else {

      const { data: updatedUser } =
        await supabase
          .from("users")
          .update({
            online: true
          })
          .eq("id", user.id)
          .select()
          .single();

      if (updatedUser) {
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


/* =====================================================
   USERS
===================================================== */

app.get("/api/users", async (req, res) => {
  try {
    const { data, error } =
      await supabase
        .from("users")
        .select("*")
        .order("username");

    if (error) throw error;

    res.json({
      success: true,
      users: data
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});


/* =====================================================
   POSTS
===================================================== */

app.post("/api/posts", async (req, res) => {
  try {
    const username =
      String(req.body.username || "").trim();

    const content =
      String(req.body.content || "").trim();

    const media_url =
      String(req.body.media_url || "").trim() || null;

    if (!username || !content) {
      return res.status(400).json({
        success: false,
        message: "Post kee guuti."
      });
    }

    const { data: user } =
      await supabase
        .from("users")
        .select("id")
        .eq("username", username)
        .maybeSingle();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Fayyadamaan hin argamne."
      });
    }

    const { data: post, error } =
      await supabase
        .from("posts")
        .insert({
          user_id: user.id,
          username,
          content,
          media_url
        })
        .select()
        .single();

    if (error) throw error;

    io.emit("newPost", post);

    res.json({
      success: true,
      post
    });

  } catch (error) {
    console.error("POST ERROR:", error);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});


/* =====================================================
   GET POSTS
===================================================== */

app.get("/api/posts", async (req, res) => {
  try {
    const { data, error } =
      await supabase
        .from("posts")
        .select(`
          *,
          post_likes(id, username),
          post_comments(id, username, comment, created_at),
          post_shares(id, username)
        `)
        .order("created_at", {
          ascending: false
        });

    if (error) throw error;

    const posts = data.map(post => ({
      ...post,
      likes_count:
        post.post_likes?.length || 0,
      comments_count:
        post.post_comments?.length || 0,
      shares_count:
        post.post_shares?.length || 0
    }));

    res.json({
      success: true,
      posts
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});


/* =====================================================
   LIKE / UNLIKE
===================================================== */

app.post("/api/posts/:id/like", async (req, res) => {
  try {
    const username =
      String(req.body.username || "").trim();

    if (!username) {
      return res.status(400).json({
        success: false,
        message: "Maqaa galchi."
      });
    }

    const { data: user } =
      await supabase
        .from("users")
        .select("id")
        .eq("username", username)
        .maybeSingle();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User hin argamne."
      });
    }

    const { data: existing } =
      await supabase
        .from("post_likes")
        .select("id")
        .eq("post_id", req.params.id)
        .eq("user_id", user.id)
        .maybeSingle();

    if (existing) {

      await supabase
        .from("post_likes")
        .delete()
        .eq("id", existing.id);

      io.emit("postUpdated", {
        postId: req.params.id
      });

      return res.json({
        success: true,
        liked: false
      });
    }

    const { error } =
      await supabase
        .from("post_likes")
        .insert({
          post_id: req.params.id,
          user_id: user.id,
          username
        });

    if (error) throw error;

    io.emit("postUpdated", {
      postId: req.params.id
    });

    res.json({
      success: true,
      liked: true
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});


/* =====================================================
   COMMENT
===================================================== */

app.post(
  "/api/posts/:id/comments",
  async (req, res) => {

    try {

      const username =
        String(req.body.username || "").trim();

      const comment =
        String(req.body.comment || "").trim();

      if (!username || !comment) {
        return res.status(400).json({
          success: false,
          message: "Comment guuti."
        });
      }

      const { data: user } =
        await supabase
          .from("users")
          .select("id")
          .eq("username", username)
          .maybeSingle();

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User hin argamne."
        });
      }

      const { data, error } =
        await supabase
          .from("post_comments")
          .insert({
            post_id: req.params.id,
            user_id: user.id,
            username,
            comment
          })
          .select()
          .single();

      if (error) throw error;

      io.emit("postUpdated", {
        postId: req.params.id
      });

      res.json({
        success: true,
        comment: data
      });

    } catch (error) {

      res.status(500).json({
        success: false,
        message: error.message
      });

    }
  }
);


/* =====================================================
   SHARE
===================================================== */

app.post("/api/posts/:id/share", async (req, res) => {

  try {

    const username =
      String(req.body.username || "").trim();

    if (!username) {
      return res.status(400).json({
        success: false,
        message: "Maqaa galchi."
      });
    }

    const { data: user } =
      await supabase
        .from("users")
        .select("id")
        .eq("username", username)
        .maybeSingle();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User hin argamne."
      });
    }

    const { data, error } =
      await supabase
        .from("post_shares")
        .insert({
          post_id: req.params.id,
          user_id: user.id,
          username
        })
        .select()
        .single();

    if (error) throw error;

    io.emit("postUpdated", {
      postId: req.params.id
    });

    res.json({
      success: true,
      share: data
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message
    });

  }

});


/* =====================================================
   CREATE CLASS
   10 SEATS
===================================================== */

app.post("/api/classes", async (req, res) => {

  try {

    const ownerName =
      String(
        req.body.ownerName || "Host"
      ).trim();

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
          name,
          owner_name: ownerName,
          max_seats: 10
        })
        .select()
        .single();

    if (error) throw error;

    const { error: seatError } =
      await supabase
        .from("class_seats")
        .insert({
          class_id: classroom.id,
          seat_number: 1,
          username: ownerName,
          role: "host"
        });

    if (seatError) throw seatError;

    res.json({
      success: true,
      class: classroom
    });

  } catch (error) {

    console.error(
      "CREATE CLASS ERROR:",
      error
    );

    res.status(500).json({
      success: false,
      message: error.message
    });

  }
});


/* =====================================================
   GET CLASSES
===================================================== */

app.get("/api/classes", async (req, res) => {

  const { data, error } =
    await supabase
      .from("classes")
      .select(`
        *,
        class_seats (*),
        class_audience (*)
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


/* =====================================================
   GET ONE CLASS
===================================================== */

app.get(
  "/api/classes/:id",
  async (req, res) => {

    const { data, error } =
      await supabase
        .from("classes")
        .select(`
          *,
          class_seats (*),
          class_audience (*)
        `)
        .eq(
          "class_id",
          req.params.id
        )
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

  }
);


/* =====================================================
   JOIN CLASS
   MAX 10 SEATS
===================================================== */

app.post(
  "/api/classes/:id/join",
  async (req, res) => {

    try {

      const username =
        String(
          req.body.username || ""
        ).trim();

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
          .eq(
            "class_id",
            req.params.id
          )
          .single();

      if (error || !classroom) {

        return res.status(404).json({
          success: false,
          message: "Kilaasiin hin argamne."
        });

      }

      const { data: existingSeat } =
        await supabase
          .from("class_seats")
          .select("*")
          .eq(
            "class_id",
            classroom.id
          )
          .eq(
            "username",
            username
          )
          .maybeSingle();

      if (existingSeat) {

        return res.json({
          success: true,
          type: "seat",
          seat: existingSeat.seat_number
        });

      }

      const { data: seats } =
        await supabase
          .from("class_seats")
          .select("*")
          .eq(
            "class_id",
            classroom.id
          )
          .order("seat_number");

      let freeSeat = null;

      for (
        let i = 1;
        i <= 10;
        i++
      ) {

        const used =
          seats.some(
            seat =>
              seat.seat_number === i
          );

        if (!used) {
          freeSeat = i;
          break;
        }

      }

      if (freeSeat) {

        const { error: seatError } =
          await supabase
            .from("class_seats")
            .insert({
              class_id: classroom.id,
              seat_number: freeSeat,
              username,
              role:
                freeSeat === 1
                  ? "host"
                  : "student"
            });

        if (seatError)
          throw seatError;

        io.to(
          `class:${classroom.id}`
        ).emit(
          "classUpdated"
        );

        return res.json({
          success: true,
          type: "seat",
          seat: freeSeat
        });

      }

      const { error: audienceError } =
        await supabase
          .from("class_audience")
          .insert({
            class_id: classroom.id,
            username
          });

      if (audienceError)
        throw audienceError;

      io.to(
        `class:${classroom.id}`
      ).emit(
        "classUpdated"
      );

      res.json({
        success: true,
        type: "audience"
      });

    } catch (error) {

      console.error(
        "JOIN CLASS ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message: error.message
      });

    }

  }
);


/* =====================================================
   LEAVE CLASS
===================================================== */

app.post(
  "/api/classes/:id/leave",
  async (req, res) => {

    try {

      const username =
        String(
          req.body.username || ""
        ).trim();

      const { data: classroom } =
        await supabase
          .from("classes")
          .select("id")
          .eq(
            "class_id",
            req.params.id
          )
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
        .eq(
          "class_id",
          classroom.id
        )
        .eq(
          "username",
          username
        );

      await supabase
        .from("class_audience")
        .delete()
        .eq(
          "class_id",
          classroom.id
        )
        .eq(
          "username",
          username
        );

      io.to(
        `class:${classroom.id}`
      ).emit(
        "classUpdated"
      );

      res.json({
        success: true
      });

    } catch (error) {

      res.status(500).json({
        success: false,
        message: error.message
      });

    }

  }
);


/* =====================================================
   CREATE ROOM
   MAX 10 SEATS
===================================================== */

app.post("/api/rooms", async (req, res) => {

  try {

    const roomId =
      "ROOM-" +
      Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase();

    const name =
      String(
        req.body.name ||
        "Mullisa-JM Room"
      ).trim();

    const owner =
      String(
        req.body.username ||
        "Host"
      ).trim();

    const { data: room, error } =
      await supabase
        .from("rooms")
        .insert({
          room_id: roomId,
          name,
          owner,
          max_seats: 10
        })
        .select()
        .single();

    if (error) throw error;

    const { error: seatError } =
      await supabase
        .from("room_seats")
        .insert({
          room_id: room.id,
          seat_number: 1,
          username: owner,
          role: "host"
        });

    if (seatError) throw seatError;

    res.json({
      success: true,
      room,
      seat: 1
    });

  } catch (error) {

    console.error(
      "CREATE ROOM ERROR:",
      error
    );

    res.status(500).json({
      success: false,
      message: error.message
    });

  }

});


/* =====================================================
   GET ROOMS
===================================================== */

app.get("/api/rooms", async (req, res) => {

  try {

    const { data, error } =
      await supabase
        .from("rooms")
        .select(`
          *,
          room_seats (*),
          room_audience (*)
        `)
        .order("created_at", {
          ascending: false
        });

    if (error) throw error;

    res.json({
      success: true,
      rooms: data
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message
    });

  }

});


/* =====================================================
   GET ONE ROOM
===================================================== */

app.get(
  "/api/rooms/:id",
  async (req, res) => {

    try {

      const { data, error } =
        await supabase
          .from("rooms")
          .select(`
            *,
            room_seats (*),
            room_audience (*)
          `)
          .eq(
            "room_id",
            req.params.id
          )
          .single();

      if (error) {

        return res.status(404).json({
          success: false,
          message: "Room hin argamne."
        });

      }

      res.json({
        success: true,
        room: data
      });

    } catch (error) {

      res.status(500).json({
        success: false,
        message: error.message
      });

    }

  }
);


/* =====================================================
   JOIN ROOM
   MAX 10 SEATS
===================================================== */

app.post(
  "/api/rooms/:id/join",
  async (req, res) => {

    try {

      const username =
        String(
          req.body.username || ""
        ).trim();

      if (!username) {

        return res.status(400).json({
          success: false,
          message: "Maqaa galchi."
        });

      }

      const { data: room, error } =
        await supabase
          .from("rooms")
          .select("*")
          .eq(
            "room_id",
            req.params.id
          )
          .single();

      if (error || !room) {

        return res.status(404).json({
          success: false,
          message: "Room hin argamne."
        });

      }

      /* Existing seat */

      const { data: existingSeat } =
        await supabase
          .from("room_seats")
          .select("*")
          .eq(
            "room_id",
            room.id
          )
          .eq(
            "username",
            username
          )
          .maybeSingle();

      if (existingSeat) {

        return res.json({
          success: true,
          type: "seat",
          seat: existingSeat.seat_number,
          role: existingSeat.role
        });

      }

      /* Existing audience */

      const { data: existingAudience } =
        await supabase
          .from("room_audience")
          .select("*")
          .eq(
            "room_id",
            room.id
          )
          .eq(
            "username",
            username
          )
          .maybeSingle();

      if (existingAudience) {

        return res.json({
          success: true,
          type: "audience"
        });

      }

      /* Get seats */

      const { data: seats } =
        await supabase
          .from("room_seats")
          .select("*")
          .eq(
            "room_id",
            room.id
          )
          .order("seat_number");

      /* Find free seat 1-10 */

      let freeSeat = null;

      for (
        let i = 1;
        i <= 10;
        i++
      ) {

        const used =
          seats.some(
            seat =>
              seat.seat_number === i
          );

        if (!used) {

          freeSeat = i;
          break;

        }

      }

      /* Seat found */

      if (freeSeat) {

        const { error: seatError } =
          await supabase
            .from("room_seats")
            .insert({
              room_id: room.id,
              seat_number: freeSeat,
              username,
              role:
                freeSeat === 1
                  ? "host"
                  : "participant"
            });

        if (seatError)
          throw seatError;

        io.to(
          `room:${room.id}`
        ).emit(
          "roomUpdated"
        );

        return res.json({
          success: true,
          type: "seat",
          seat: freeSeat,
          role:
            freeSeat === 1
              ? "host"
              : "participant"
        });

      }

      /* No seat */

      const { error: audienceError } =
        await supabase
          .from("room_audience")
          .insert({
            room_id: room.id,
            username
          });

      if (audienceError)
        throw audienceError;

      io.to(
        `room:${room.id}`
      ).emit(
        "roomUpdated"
      );

      res.json({
        success: true,
        type: "audience",
        message:
          "Teessoon 10 guuteera. Ati daaw'ataa taate."
      });

    } catch (error) {

      console.error(
        "JOIN ROOM ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message: error.message
      });

    }

  }
);


/* =====================================================
   LEAVE ROOM
===================================================== */

app.post(
  "/api/rooms/:id/leave",
  async (req, res) => {

    try {

      const username =
        String(
          req.body.username || ""
        ).trim();

      const { data: room } =
        await supabase
          .from("rooms")
          .select("id")
          .eq(
            "room_id",
            req.params.id
          )
          .single();

      if (!room) {

        return res.status(404).json({
          success: false,
          message: "Room hin argamne."
        });

      }

      await supabase
        .from("room_seats")
        .delete()
        .eq(
          "room_id",
          room.id
        )
        .eq(
          "username",
          username
        );

      await supabase
        .from("room_audience")
        .delete()
        .eq(
          "room_id",
          room.id
        )
        .eq(
          "username",
          username
        );

      io.to(
        `room:${room.id}`
      ).emit(
        "roomUpdated"
      );

      res.json({
        success: true
      });

    } catch (error) {

      res.status(500).json({
        success: false,
        message: error.message
      });

    }

  }
);


/* =====================================================
   CALL RECORD
===================================================== */

app.post("/api/calls", async (req, res) => {

  try {

    const {
      caller_id,
      caller_name,
      receiver_id,
      receiver_name,
      call_type
    } = req.body;

    const { data, error } =
      await supabase
        .from("calls")
        .insert({
          caller_id,
          caller_name,
          receiver_id,
          receiver_name,
          call_type:
            call_type || "audio",
          status: "calling"
        })
        .select()
        .single();

    if (error) throw error;

    res.json({
      success: true,
      call: data
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message
    });

  }

});


/* =====================================================
   END CALL
===================================================== */

app.patch(
  "/api/calls/:id/end",
  async (req, res) => {

    try {

      const { error } =
        await supabase
          .from("calls")
          .update({
            status: "ended",
            ended_at:
              new Date().toISOString()
          })
          .eq(
            "id",
            req.params.id
          );

      if (error) throw error;

      res.json({
        success: true
      });

    } catch (error) {

      res.status(500).json({
        success: false,
        message: error.message
      });

    }

  }
);


/* =====================================================
   SOCKET.IO
===================================================== */

io.on("connection", socket => {

  console.log(
    "🟢 Connected:",
    socket.id
  );


  /* ---------------------------------
     USER ONLINE
  --------------------------------- */

  socket.on(
    "userOnline",
    async user => {

      if (
        !user ||
        !user.username
      ) return;

      socket.username =
        user.username;

      socket.userId =
        user.id || null;

      if (user.id) {

        await supabase
          .from("users")
          .update({
            online: true
          })
          .eq(
            "id",
            user.id
          );

      }

      io.emit(
        "usersUpdated"
      );

    }
  );


  /* ---------------------------------
     JOIN CLASS
  --------------------------------- */

  socket.on(
    "joinClass",
    async data => {

      if (
        !data ||
        !data.classId
      ) return;

      const { data: classroom } =
        await supabase
          .from("classes")
          .select("id")
          .eq(
            "class_id",
            data.classId
          )
          .single();

      if (!classroom) {

        socket.emit(
          "errorMessage",
          {
            message:
              "Kilaasiin hin argamne."
          }
        );

        return;
      }

      socket.join(
        `class:${classroom.id}`
      );

      socket.classId =
        classroom.id;

      socket.to(
        `class:${classroom.id}`
      ).emit(
        "userJoinedClass",
        {
          username:
            data.username
        }
      );

    }
  );


  /* ---------------------------------
     CLASS CHAT
  --------------------------------- */

  socket.on(
    "classMessage",
    message => {

      if (!socket.classId)
        return;

      io.to(
        `class:${socket.classId}`
      ).emit(
        "classMessage",
        {
          username:
            socket.username ||
            "User",
          message,
          time:
            new Date().toISOString()
        }
      );

    }
  );


  /* ---------------------------------
     JOIN ROOM SOCKET
  --------------------------------- */

  socket.on(
    "joinRoom",
    async data => {

      if (
        !data ||
        !data.roomId
      ) return;

      const { data: room } =
        await supabase
          .from("rooms")
          .select("id")
          .eq(
            "room_id",
            data.roomId
          )
          .single();

      if (!room) {

        socket.emit(
          "errorMessage",
          {
            message:
              "Room hin argamne."
          }
        );

        return;
      }

      socket.join(
        `room:${room.id}`
      );

      socket.roomId =
        room.id;

      socket.roomCode =
        data.roomId;

      socket.to(
        `room:${room.id}`
      ).emit(
        "roomUserJoined",
        {
          username:
            socket.username ||
            data.username ||
            "User"
        }
      );

    }
  );


  /* ---------------------------------
     ROOM CHAT
  --------------------------------- */

  socket.on(
    "roomMessage",
    message => {

      if (!socket.roomId)
        return;

      io.to(
        `room:${socket.roomId}`
      ).emit(
        "roomMessage",
        {
          username:
            socket.username ||
            "User",
          message,
          time:
            new Date().toISOString()
        }
      );

    }
  );


  /* ---------------------------------
     PRIVATE MESSAGE
  --------------------------------- */

  socket.on(
    "privateMessage",
    data => {

      if (
        !data ||
        !data.to
      ) return;

      io.to(
        data.to
      ).emit(
        "privateMessage",
        {
          from:
            socket.username ||
            "User",
          message:
            data.message,
          time:
            new Date().toISOString()
        }
      );

    }
  );


  /* ---------------------------------
     AUDIO / VIDEO CALL
  --------------------------------- */

  socket.on(
    "callUser",
    data => {

      if (
        !data ||
        !data.to
      ) return;

      io.to(
        data.to
      ).emit(
        "incomingCall",
        {
          from:
            socket.id,
          username:
            socket.username ||
            "User",
          callType:
            data.callType ||
            "audio",
          offer:
            data.offer || null
        }
      );

    }
  );


  socket.on(
    "acceptCall",
    data => {

      if (
        !data ||
        !data.to
      ) return;

      io.to(
        data.to
      ).emit(
        "callAccepted",
        {
          from:
            socket.id,
          answer:
            data.answer ||
            null
        }
      );

    }
  );


  socket.on(
    "rejectCall",
    data => {

      if (
        !data ||
        !data.to
      ) return;

      io.to(
        data.to
      ).emit(
        "callRejected",
        {
          from:
            socket.id
        }
      );

    }
  );


  socket.on(
    "endCall",
    data => {

      if (
        !data ||
        !data.to
      ) return;

      io.to(
        data.to
      ).emit(
        "callEnded",
        {
          from:
            socket.id
        }
      );

    }
  );


  /* ---------------------------------
     WEBRTC OFFER
  --------------------------------- */

  socket.on(
    "offer",
    data => {

      if (
        !data ||
        !data.to
      ) return;

      io.to(
        data.to
      ).emit(
        "offer",
        {
          from:
            socket.id,
          offer:
            data.offer
        }
      );

    }
  );


  /* ---------------------------------
     WEBRTC ANSWER
  --------------------------------- */

  socket.on(
    "answer",
    data => {

      if (
        !data ||
        !data.to
      ) return;

      io.to(
        data.to
      ).emit(
        "answer",
        {
          from:
            socket.id,
          answer:
            data.answer
        }
      );

    }
  );


  /* ---------------------------------
     ICE CANDIDATE
  --------------------------------- */

  socket.on(
    "ice-candidate",
    data => {

      if (
        !data ||
        !data.to
      ) return;

      io.to(
        data.to
      ).emit(
        "ice-candidate",
        {
          from:
            socket.id,
          candidate:
            data.candidate
        }
      );

    }
  );


  /* ---------------------------------
     MIC STATUS
  --------------------------------- */

  socket.on(
    "micStatus",
    status => {

      if (socket.classId) {

        socket.to(
          `class:${socket.classId}`
        ).emit(
          "micStatus",
          {
            username:
              socket.username ||
              "User",
            status
          }
        );

      }

      if (socket.roomId) {

        socket.to(
          `room:${socket.roomId}`
        ).emit(
          "micStatus",
          {
            username:
              socket.username ||
              "User",
            status
          }
        );

      }

    }
  );


  /* ---------------------------------
     CAMERA STATUS
  --------------------------------- */

  socket.on(
    "cameraStatus",
    status => {

      if (!socket.roomId)
        return;

      socket.to(
        `room:${socket.roomId}`
      ).emit(
        "cameraStatus",
        {
          username:
            socket.username ||
            "User",
          status
        }
      );

    }
  );


  /* ---------------------------------
     RAISE HAND
  --------------------------------- */

  socket.on(
    "raiseHand",
    status => {

      if (!socket.roomId)
        return;

      socket.to(
        `room:${socket.roomId}`
      ).emit(
        "raiseHand",
        {
          username:
            socket.username ||
            "User",
          status
        }
      );

    }
  );


  /* ---------------------------------
     MUTE USER
  --------------------------------- */

  socket.on(
    "muteUser",
    data => {

      if (!socket.roomId)
        return;

      io.to(
        `room:${socket.roomId}`
      ).emit(
        "userMuted",
        {
          username:
            data?.username ||
            "User"
        }
      );

    }
  );


  /* ---------------------------------
     DISCONNECT
  --------------------------------- */

  socket.on(
    "disconnect",
    async () => {

      console.log(
        "🔴 Disconnected:",
        socket.id
      );

      if (socket.username) {

        await supabase
          .from("users")
          .update({
            online: false
          })
          .eq(
            "username",
            socket.username
          );

      }

      if (socket.classId) {

        socket.to(
          `class:${socket.classId}`
        ).emit(
          "userLeftClass",
          {
            username:
              socket.username
          }
        );

      }

      if (socket.roomId) {

        socket.to(
          `room:${socket.roomId}`
        ).emit(
          "roomUserLeft",
          {
            username:
              socket.username
          }
        );

      }

      io.emit(
        "usersUpdated"
      );

    }
  );

});


/* =====================================================
   START SERVER
===================================================== */

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "================================"
    );

    console.log(
      "🟢 MULLISA-JM SERVER"
    );

    console.log(
      "================================"
    );

    console.log(
      "🚀 Port:",
      PORT
    );

    console.log(
      "📡 Socket.IO: ON"
    );

    console.log(
      "🗄️ Supabase: ON"
    );

    console.log(
      "🎓 Classes: ON"
    );

    console.log(
      "🪑 Class seats: 10"
    );

    console.log(
      "🚪 Rooms: ON"
    );

    console.log(
      "🪑 Room seats: 10"
    );

    console.log(
      "👥 Audience: ON"
    );

    console.log(
      "📝 Posts: ON"
    );

    console.log(
      "❤️ Likes: ON"
    );

    console.log(
      "💬 Comments: ON"
    );

    console.log(
      "🔄 Shares: ON"
    );

    console.log(
      "📞 Audio calls: ON"
    );

    console.log(
      "🎥 Video calls: ON"
    );

    console.log(
      "================================"
    );

  }
);
