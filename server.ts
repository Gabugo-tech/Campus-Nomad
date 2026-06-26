import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Server } from "socket.io";
import { createServer } from "http";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

function generatePolishedFallbackSvg(prompt: string): string {
  // Simple prompt hash
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    hash = (hash << 5) - hash + prompt.charCodeAt(i);
    hash |= 0;
  }
  hash = Math.abs(hash);

  const PALETTES = [
    { bgStart: "#0f172a", bgEnd: "#1e1b4b", primary: "#6366f1", secondary: "#a5b4fc", accent: "#fb7185", text: "#e0e7ff" }, // Cyber Twilight
    { bgStart: "#022c22", bgEnd: "#064e3b", primary: "#10b981", secondary: "#6ee7b7", accent: "#f59e0b", text: "#ecfdf5" }, // Emerald Forest
    { bgStart: "#1e1b4b", bgEnd: "#311042", primary: "#8b5cf6", secondary: "#c084fc", accent: "#f472b6", text: "#f5f3ff" }, // Cosmic Amethyst
    { bgStart: "#0c0a09", bgEnd: "#292524", primary: "#f97316", secondary: "#fdba74", accent: "#e7e5e4", text: "#fafaf9" }, // Warm Amber
    { bgStart: "#0f172a", bgEnd: "#0f172a", primary: "#3b82f6", secondary: "#60a5fa", accent: "#67e8f9", text: "#f0f9ff" }, // High Tech Slate
    { bgStart: "#18001d", bgEnd: "#31003f", primary: "#d946ef", secondary: "#fd0061", accent: "#f43f5e", text: "#fae8ff" }, // Magenta Eclipse
  ];

  const p = PALETTES[hash % PALETTES.length];
  const trimmed = prompt.trim();
  const firstLetter = trimmed ? trimmed.charAt(0).toUpperCase() : "S";
  const secondLetter = trimmed.length > 1 ? trimmed.charAt(1).toUpperCase() : "";
  const initials = /^[A-Z0-9]$/i.test(firstLetter) ? (firstLetter + (/^[A-Z0-9]$/i.test(secondLetter) ? secondLetter : "")) : "AI";

  // Build a collection of concentric decorations based on hash
  const numCircles = 3 + (hash % 3);
  let circlesSvg = "";
  for (let i = 0; i < numCircles; i++) {
    const r = 90 + i * 40;
    const strokeWidth = 1.5 + (i * 0.5);
    const opacity = 0.15 - (i * 0.03);
    const dashArray = (hash % 2 === 0) ? `${20 + i * 10} ${10 + i * 5}` : "none";
    circlesSvg += `<circle cx="256" cy="256" r="${r}" fill="none" stroke="${p.secondary}" stroke-width="${strokeWidth}" stroke-dasharray="${dashArray}" opacity="${opacity}" />`;
  }

  // Generate beautiful rotating polygons or stars based on hash
  const numPoints = 5 + (hash % 6); // 5 to 10 points
  let polyPoints = "";
  for (let i = 0; i < numPoints * 2; i++) {
    const angle = (i * Math.PI) / numPoints;
    const radius = i % 2 === 0 ? 120 : 60;
    const x = 256 + Math.cos(angle) * radius;
    const y = 256 + Math.sin(angle) * radius;
    polyPoints += `${x.toFixed(1)},${y.toFixed(1)} `;
  }

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
      <defs>
        <linearGradient id="coolGrad_${hash}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${p.bgStart}" />
          <stop offset="100%" stop-color="${p.bgEnd}" />
        </linearGradient>
        <linearGradient id="primaryGrad_${hash}" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${p.primary}" />
          <stop offset="100%" stop-color="${p.accent}" stop-opacity="0.8" />
        </linearGradient>
        <filter id="glow_${hash}" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="15" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      
      <!-- Background -->
      <rect width="512" height="512" fill="url(#coolGrad_${hash})" rx="128" />
      
      <!-- Ambient central glow background -->
      <circle cx="256" cy="256" r="140" fill="url(#primaryGrad_${hash})" opacity="0.3" filter="url(#glow_${hash})" />
      
      <!-- Concentric tech rings -->
      \${circlesSvg}
      
      <!-- Elegant geometric star / abstract shape -->
      <polygon points="\${polyPoints.trim()}" fill="none" stroke="url(#primaryGrad_\${hash})" stroke-width="2.5" opacity="0.4" transform="rotate(\${(hash % 360)}, 256, 256)" />
      <polygon points="\${polyPoints.trim()}" fill="none" stroke="\${p.accent}" stroke-width="1" opacity="0.2" transform="rotate(\${(hash % 360) + 45}, 256, 256) scale(0.85)" />

      <!-- Centered visual glassmorphic capsule -->
      <circle cx="256" cy="256" r="75" fill="\${p.bgStart}" fill-opacity="0.4" stroke="\${p.secondary}" stroke-width="2" stroke-opacity="0.3" filter="url(#glow_\${hash})" />
      
      <!-- Beautifully typography-aligned Initials -->
      <text x="256" y="274" 
            font-family="system-ui, -apple-system, sans-serif" 
            font-weight="700" 
            font-size="52" 
            fill="\${p.text}" 
            text-anchor="middle" 
            letter-spacing="-1" 
            opacity="0.95">\${initials}</text>
            
      <!-- Subtle visual accent border -->
      <rect x="8" y="8" width="496" height="496" fill="none" stroke="\${p.secondary}" stroke-width="2" stroke-opacity="0.08" rx="120" />
    </svg>
  `.trim();
}

async function startServer() {
  const app = express();

  let aiClient: GoogleGenAI | null = null;
  function getGeminiClient(): GoogleGenAI {
    if (!aiClient) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY environment variable is required. Please set up the Gemini API key in Settings > Secrets inside the AI Studio dashboard.");
      }
      aiClient = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
    }
    return aiClient;
  }
  
  // Trust proxy to resolve rate limiting/X-Forwarded-For validation warnings in container deployments
  app.set("trust proxy", 1);
  
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

  // CSRF safe-keeping map
  const csrfTokensStore = new Map<string, number>();

  function generateCsrfToken(): string {
    const token = crypto.randomBytes(32).toString("hex");
    csrfTokensStore.set(token, Date.now() + 2 * 60 * 60 * 1000); // Valid for 2 hours
    return token;
  }

  function isValidCsrfToken(token: string | undefined | null): boolean {
    if (!token) return false;
    const expiry = csrfTokensStore.get(token);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      csrfTokensStore.delete(token);
      return false;
    }
    return true;
  }

  // Periodic cleanup
  setInterval(() => {
    const now = Date.now();
    for (const [token, expiry] of csrfTokensStore.entries()) {
      if (now > expiry) {
        csrfTokensStore.delete(token);
      }
    }
  }, 10 * 60 * 1000);

  // Rate Limiting Config
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 mins
    max: 200, // limit each IP to 200 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests to this student helper endpoint. Rate limit exceeded!" }
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 mins
    max: 40, // limit each IP for authentication/verification/token requests
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Brute force defense: Please slow down your requests!" }
  });

  // Apply general rate-limiter to all /api routes
  app.use("/api/", apiLimiter);

  app.use(express.json());

  // CSRF validation middleware for standard state-changing routes
  app.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return next();
    }
    const clientToken = req.headers["x-csrf-token"] || req.body?._csrf;
    if (typeof clientToken === "string" && isValidCsrfToken(clientToken)) {
      return next();
    }
    return res.status(403).json({ error: "Invalid or missing CSRF token" });
  });

  // CSRF token generation route protected with the stricter authLimiter
  app.get("/api/csrf-token", authLimiter, (req, res) => {
    const token = generateCsrfToken();
    res.json({ csrfToken: token });
  });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/generate-avatar", async (req, res) => {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Please enter a valid prompt to generate an avatar." });
    }

    try {
      // Constrain and design prompt specifically to generate beautiful high quality centered square profile avatars
      const structuredPrompt = `A premium quality 3D vector style, or watercolor, or minimalist artistic flat style avatar of: ${prompt}. Centered composition, solid or simple soft gradient background, no text, no watermarks, gorgeous vibrant color contrast, optimized for 1:1 format profile picture.`;

      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            {
              text: structuredPrompt,
            },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: "1:1"
          }
        }
      });

      let imageUrl: string | null = null;
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            const base64EncodeString: string = part.inlineData.data;
            imageUrl = `data:image/png;base64,${base64EncodeString}`;
            break;
          }
        }
      }

      if (!imageUrl) {
        throw new Error("Empty image payload from Gemini API");
      }

      res.json({ imageUrl });
    } catch (err: any) {
      console.warn("AI image generation failed, falling back to custom geometric vector rendering. Error details:", err);
      
      try {
        const fallbackSvg = generatePolishedFallbackSvg(prompt);
        const base64EncodeString = Buffer.from(fallbackSvg).toString("base64");
        const imageUrl = `data:image/svg+xml;base64,${base64EncodeString}`;
        
        return res.json({
          imageUrl,
          isFallback: true,
          warning: "Your Gemini API Key has exceeded its free-tier quota. We've generated a premium, custom vector geometric avatar for you instead! Tip: You can configure a personal key or choose a paid model in Google AI Studio to unlock full Imagen features."
        });
      } catch (fallbackErr: any) {
        console.error("Critical: Fallback SVG generation crashed:", fallbackErr);
        res.status(500).json({ 
          error: err.message || "An error occurred during image generation. Please try again." 
        });
      }
    }
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

  // Socket.io standard CSRF protection middleware
  io.use((socket: any, next: any) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.["x-csrf-token"];
    if (isValidCsrfToken(token)) {
      return next();
    }
    console.warn("Rejected socket connection due to invalid/missing CSRF token:", socket.id);
    return next(new Error("CSRF token validation failed"));
  });

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
