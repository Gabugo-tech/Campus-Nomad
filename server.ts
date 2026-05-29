import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Server } from "socket.io";
import { createServer } from "http";
import dotenv from "dotenv";
import helmet from "helmet";

dotenv.config();

async function startServer() {
  const app = express();
  
  // Implement Helmet middleware with customized secure headers
  app.use(
    helmet({
      // Content Security Policy (CSP) customized for modern full-stack web applications,
      // avoiding blocking Firebase integrations, external APIs, Google Fonts, and Dicebear avatars.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            "'unsafe-eval'", // Required by Vite in both dev and production hot rebuild checks
            "https://*.firebaseapp.com",
            "https://*.googleapis.com",
          ],
          connectSrc: [
            "'self'",
            "https:",
            "http:",
            "wss:",
            "ws:", // Dynamic WebSocket support for socket.io in developer environment
          ],
          imgSrc: [
            "'self'",
            "data:",
            "blob:",
            "https://api.dicebear.com",
            "https://images.unsplash.com",
            "https://*.googleusercontent.com", 
            "https://*.firestore.googleapis.com",
            "https://*.firebaseapp.com",
          ],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://fonts.googleapis.com",
          ],
          fontSrc: [
            "'self'",
            "https://fonts.gstatic.com",
          ],
          mediaSrc: ["'self'", "data:", "blob:"],
          frameSrc: [
            "'self'",
            "https://*.firebaseapp.com",
          ],
          frameAncestors: ["*"],
          objectSrc: ["'none'"],
        },
      },
      // Disable HTST (HSTS) in development to avoid iframe redirect and loading timeouts
      strictTransportSecurity: false,
      // Prevent MIME type sniffing
      noSniff: true,
      // Enable browser XSS protection filter
      xXssProtection: true,
      // Referrer-Policy
      referrerPolicy: {
        policy: "strict-origin-when-cross-origin",
      },
      // Set to false to support framing within the platform's preview dashboard context/iframes
      frameguard: false,
    })
  );

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Verification Domain List
  const approvedDomains = ["unilag.edu.ng", "ui.edu.ng", "lasu.edu.ng", "oauife.edu.ng"];
  
  app.get("/api/domains", (req, res) => {
    res.json(approvedDomains);
  });

  // Nigerian Universities Fallback
  const fallbackUniversities = [
    { "name": "Abubakar Tafawa Balewa University, Bauchi", "country": "Nigeria" },
    { "name": "Ahmadu Bello University, Zaria", "country": "Nigeria" },
    { "name": "Bayero University, Kano", "country": "Nigeria" },
    { "name": "Federal University of Agriculture, Abeokuta", "country": "Nigeria" },
    { "name": "Federal University of Technology, Akure", "country": "Nigeria" },
    { "name": "Federal University of Technology, Minna", "country": "Nigeria" },
    { "name": "Federal University of Technology, Owerri", "country": "Nigeria" },
    { "name": "Federal University of Petroleum Resources, Effurun", "country": "Nigeria" },
    { "name": "Obafemi Awolowo University, Ile-Ife", "country": "Nigeria" },
    { "name": "University of Abuja", "country": "Nigeria" },
    { "name": "University of Benin", "country": "Nigeria" },
    { "name": "University of Calabar", "country": "Nigeria" },
    { "name": "University of Ibadan", "country": "Nigeria" },
    { "name": "University of Ilorin", "country": "Nigeria" },
    { "name": "University of Jos", "country": "Nigeria" },
    { "name": "University of Lagos", "country": "Nigeria" },
    { "name": "University of Maiduguri", "country": "Nigeria" },
    { "name": "University of Nigeria, Nsukka", "country": "Nigeria" },
    { "name": "University of Port Harcourt", "country": "Nigeria" },
    { "name": "University of Uyo", "country": "Nigeria" },
    { "name": "Lagos State University, Ojo", "country": "Nigeria" },
    { "name": "Covenant University, Ota", "country": "Nigeria" },
    { "name": "Babcock University, Ilishan-Remo", "country": "Nigeria" },
    { "name": "Pan-Atlantic University, Lekki", "country": "Nigeria" }
  ];

  // Nigerian Universities List Proxy
  app.get("/api/universities", async (req, res) => {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch("https://universities.hipolabs.com/search?country=Nigeria", {
        signal: controller.signal
      });
      clearTimeout(id);
      
      if (!response.ok) {
        throw new Error(`Status ${response.status}`);
      }
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      // Quietly return fallback list to avoid warning and error spikes
      res.json(fallbackUniversities);
    }
  });

  // Active calls registry
  const activeCalls: { [key: string]: { callerId: string; receiverId: string; startTime: number } } = {};

  // Socket.io for Real-time Chat and Calls
  io.on("connection", (socket: any) => {
    console.log("A user connected:", socket.id);

    // Dynamic custom user room logic
    socket.on("join-user-room", (userId) => {
      socket.userId = userId;
      socket.join(userId);
      console.log(`Socket ${socket.id} bound to individual UserRoom: ${userId}`);
    });

    socket.on("join-chat", (chatId) => {
      socket.join(chatId);
      console.log(`User ${socket.id} joined chat ${chatId}`);
    });

    socket.on("join-group-call-room", (data) => {
      // data: { roomId, userId, userName, userAvatar }
      const roomId = data.roomId;
      socket.join(roomId);
      console.log(`Socket ${socket.id} (user ${data.userId}) joined group call room ${roomId}`);
      // Notify other participants in the room that a user joined
      socket.to(roomId).emit("user-joined-group-call", {
        userId: data.userId,
        userName: data.userName,
        userAvatar: data.userAvatar,
        socketId: socket.id
      });
    });

    socket.on("leave-group-call-room", (data) => {
      const roomId = data.roomId;
      socket.leave(roomId);
      console.log(`Socket ${socket.id} left group call room ${roomId}`);
      socket.to(roomId).emit("user-left-group-call", {
        userId: data.userId
      });
    });

    socket.on("send-message", (data) => {
      // data: { chatId, senderId, text, createdAt }
      io.to(data.chatId).emit("receive-message", data);
      
      // Emit notification to user room of individual receiver
      if (data.chatId) {
        const parts = data.chatId.split('_');
        const receiverId = parts.find(p => p !== data.senderId);
        if (receiverId) {
          io.to(receiverId).emit("receive-message-notification", data);
        }
      }
    });

    socket.on("typing", (data) => {
      socket.to(data.chatId).emit("user-typing", data);
    });

    // Real-time voice/video dynamic handshake
    socket.on("call-user", (data) => {
      // data: { callerId, callerName, callerAvatar, receiverId, callType }
      socket.to(data.receiverId).emit("incoming-call", data);
    });

    socket.on("accept-call", (data) => {
      // data: { callerId, receiverId }
      const key = [data.callerId, data.receiverId].sort().join('_');
      activeCalls[key] = {
        callerId: data.callerId,
        receiverId: data.receiverId,
        startTime: Date.now()
      };
      
      console.log(`Call key ${key} registered at timestamp ${activeCalls[key].startTime}`);
      socket.to(data.callerId).emit("call-accepted", data);
      
      // Emit sync timestamps to both user rooms
      io.to(data.callerId).emit("call-timestamp-sync", { startTime: activeCalls[key].startTime });
      io.to(data.receiverId).emit("call-timestamp-sync", { startTime: activeCalls[key].startTime });
    });

    socket.on("reject-call", (data) => {
      // data: { callerId, receiverId }
      socket.to(data.callerId).emit("call-rejected", data);
    });

    socket.on("end-call", (data) => {
      // data: { otherPartyId, callerId, receiverId }
      const userId = socket.userId || data.callerId || "unknown";
      const key = [userId, data.otherPartyId].sort().join('_');
      if (activeCalls[key]) {
        const durationSec = Math.floor((Date.now() - activeCalls[key].startTime) / 1000);
        console.log(`Call channel ${key} closed. Duration tracked on server: ${durationSec} seconds.`);
        delete activeCalls[key];
      }
      socket.to(data.otherPartyId).emit("call-ended", data);
    });

    socket.on("webrtc-signal", (data) => {
      // data: { targetId, senderId, type, offer, answer, candidate }
      if (data.targetId) {
        socket.to(data.targetId).emit("webrtc-signal", data);
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected");
      if (socket.userId) {
        // Find and clean up any call this socket was a part of
        Object.keys(activeCalls).forEach(key => {
          if (activeCalls[key].callerId === socket.userId || activeCalls[key].receiverId === socket.userId) {
            const durationSec = Math.floor((Date.now() - activeCalls[key].startTime) / 1000);
            console.log(`Call ${key} closed on socket disconnect. Duration: ${durationSec} seconds.`);
            const peerId = activeCalls[key].callerId === socket.userId ? activeCalls[key].receiverId : activeCalls[key].callerId;
            io.to(peerId).emit("call-ended", { otherPartyId: socket.userId });
            delete activeCalls[key];
          }
        });
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
