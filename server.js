const express = require('express');
const cors = require("cors");
const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');
const result = dotenv.config();
const session = require('express-session');
const MongoStore = require("connect-mongo");
const bcrypt = require('bcrypt');
const Customer = require('./models/Customer');
const multer = require('multer');
const fs = require('fs');
const inviteRoutes = require('./routes/inviteRoutes');
const insightsRoutes = require('./routes/insights');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const csrf = require('csurf');
const cookieParser = require('cookie-parser');
const zxcvbn = require('zxcvbn');


dotenv.config();
const app = express();
app.set('trust proxy', 1); // ⬅️ KRÄVS på Render för att secure cookies ska funka
const http = require('http').createServer(app);

// 🖼️ Profilbild-lagring
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, uniqueName);
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Max 5 MB
  fileFilter: (req, file, cb) => {
// i multer-konfigurationen
const allowedMimes = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/jfif',
  'image/heic',
  'image/heif'
];
    if (allowedMimes.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Ogiltig filtyp. Endast bilder tillåtna.'));
    }
  }
});

// 🌍 CORS – tillåtna domäner
const allowedOrigins = [
  "http://localhost:3000",
  "https://source-database.onrender.com",
  "https://admin-portal-rn5z.onrender.com"
];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS-fel: Ursprung inte tillåtet"));
    }
  },
  credentials: true
}));

// 💾 Session-hantering med MongoStore
// Gör session-middleware återanvändbar (Express + Socket.IO)
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'source_secret_key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    dbName: "adminportal"
  }),
  cookie: {
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 2
  }
});
app.use(sessionMiddleware);

// 🧱 Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '200kb' }));
app.use(express.json({ limit: '200kb' }));
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
  }));
  // Grundläggande Content Security Policy i report-only-läge
app.use(helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "https://apis.google.com", "https://cdn.jsdelivr.net"],
    styleSrc: ["'self'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    imgSrc: ["'self'", "data:", "https://*"],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    upgradeInsecureRequests: [],
  },
  reportOnly: true
  }));
app.use(helmet.referrerPolicy({ policy: 'no-referrer' })); // läck inte referers
  if (process.env.NODE_ENV === 'production') {
  app.use(helmet.hsts({ maxAge: 15552000 })); // ~180 dagar, endast i prod/HTTPS
  }

  const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,      // 15 minuter
  max: 10,                       // max 10 försök/IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'För många inloggningsförsök. Försök igen senare.' }
});

const { router: securityRouter, requireAuth } = require("./routes/security");

// Efter cookieParser
app.use(cookieParser());
const csrfProtection = csrf({ cookie: true });

// Kör CSRF globalt för allt UTOM multipart-rutten (Multer först)
const csrfExclude = new Set([
  '/api/profile/update',
  '/api/support/ticket' // ⬅️ NYTT undantag
]);


// Ge klienten ett sätt att hämta token (kräver att CSRF-mw redan körts)
app.get('/csrf-token', (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Fångar ogiltig/saknad CSRF-token
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ success: false, message: 'Ogiltig eller saknad CSRF-token' });
  }
  next(err);
});

// 🧭 Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/chatwindow.html', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'chatwindow.html')));
app.get('/customerportal.html', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'customerportal.html')));
app.get('/fakturor.html', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'fakturor.html')));
app.get('/rapporter.html', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'rapporter.html')));
app.get('/inventarier.html', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'inventarier.html')));
app.get('/kontakt.html', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'kontakt.html')));
app.get('/kunder.html', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'kunder.html')));
app.use('/api/profile', require('./routes/profile'));
app.get('/admin-logins.html', requireLogin, (req, res) => {
  const user = req.session?.user;
  if (!user || user.role !== "admin") return res.status(403).send("Åtkomst nekad");
  res.sendFile(path.join(__dirname, 'public', 'admin-logins.html'));
});



// 🔌 Socket.IO
const io = require('socket.io')(http, {
  cors: {
    origin: allowedOrigins,
    credentials: true
  }
});
const axios = require('axios');

// Dela Express-session med Socket.IO
io.engine.use(sessionMiddleware);

// Auth-guard: blockera icke-inloggade och minimera PII
io.use((socket, next) => {
  try {
    const user = socket.request?.session?.user;
    if (!user?._id) return next(new Error('unauthorized'));
    // Spara endast minsta möjliga data på socketen
    socket.data.user = { _id: user._id, role: user.role, name: user.name };
    return next();
  } catch {
    return next(new Error('unauthorized'));
  }
});

io.on("connection", (socket) => {
  const user = socket.data?.user; // {_id, role, name} – satt av io.use(...)
  console.log("🟢 Socket.IO anslutning", { userId: user?._id, role: user?.role });

  // 🆕 Ny session: skicka bara minimal data
  socket.on("startSession", (sessionData = {}) => {
    const sessionId = typeof sessionData.sessionId === "string" ? sessionData.sessionId : "";
    // Validera sessionId
    if (!/^[A-Za-z0-9._-]{8,128}$/.test(sessionId)) return;
    const startedAt = sessionData.startedAt ? new Date(sessionData.startedAt).toISOString() : new Date().toISOString();

    // Broadcasta utan PII
    io.emit("newSession", { sessionId, startedAt });
  });

  // ✉️ Meddelande: sanera, validera, sätt sender från roll
  socket.on("sendMessage", (msg = {}) => {
    const raw = typeof msg.message === "string" ? msg.message : "";
    let message = raw.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    if (!message) return;
    if (message.length > 2000) message = message.slice(0, 2000);

    const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : "";
    if (!/^[A-Za-z0-9._-]{8,128}$/.test(sessionId)) return;

    const sender = user?.role === "admin" ? "admin" : "customer";

    // Skicka endast minsta nödvändiga
    io.emit("newMessage", {
      message,
      sender,
      timestamp: new Date().toISOString(),
      sessionId
    });
  });

  // ✅ Avsluta chattsession och skicka minimal data till admin-API
socket.on("endSession", async (payload = {}) => {
  try {
    // Validera sessionId
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
    if (!/^[A-Za-z0-9._-]{8,128}$/.test(sessionId)) return;

    // Begränsa och sanera meddelanden (max 200)
    const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
    const messages = rawMessages.slice(0, 200).map(m => {
      const raw = typeof m?.message === "string" ? m.message : "";
      let message = raw.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
      if (!message) return null;
      if (message.length > 2000) message = message.slice(0, 2000);

      const sender = ["admin", "customer", "system"].includes(m?.sender) ? m.sender : "customer";
      const ts = new Date(m?.timestamp || Date.now()).toISOString();
      const sid = (typeof m?.sessionId === "string" && /^[A-Za-z0-9._-]{8,128}$/.test(m.sessionId)) ? m.sessionId : sessionId;

      return { message, sender, timestamp: ts, sessionId: sid };
    }).filter(Boolean);

    // Minimal payload till admin-API (ingen e-post, inga profiler)
    const caseData = {
      sessionId,
      startedAt: payload.startedAt ? new Date(payload.startedAt).toISOString() : undefined,
      endedAt: new Date().toISOString(),
      messages
    };
    Object.keys(caseData).forEach(k => caseData[k] === undefined && delete caseData[k]);

    // URL + timeout via .env med säkra default
    const url = process.env.ADMIN_CASES_URL || "https://admin-portal-rn5z.onrender.com/api/cases";
    const timeout = Number(process.env.ADMIN_CASES_TIMEOUT_MS || 8000);

    await axios.post(url, caseData, { timeout });
    console.log("💾 Chatten sparad till adminportal ✅");
  } catch (err) {
    console.error("❌ Kunde inte spara chatten till adminportal:", err.message || err);
  }
});

  socket.on("disconnect", () => {
    console.log("🔴 Frånkopplad", { userId: user?._id });
  });
});

// 🛢️ MongoDB-anslutning
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('🟢 Ansluten till MongoDB Atlas');

    // ✅ Lägg till detta här
    require('./cron/insightCron');
  })
  .catch(err => console.error('🔴 Fel vid MongoDB:', err));


// 🛡️ Skyddad route
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login.html');
  next();
}

// 🔐 Legacy-inloggning avvecklad – använd /api/auth/login
app.post('/login', (req, res) => {
  return res.status(410).json({
    success: false,
    message: 'Endpoint avvecklad. Använd /api/auth/login.'
  });
});


// 📦 Dummy-inventarielager
let inventory = {
  TS1001: { name: "Vit T-shirt",  stock: 0  },
  HD1002: { name: "Svart Hoodie",  stock: 12 },
  KP1003: { name: "Blå Keps",      stock: 3  },
  GM1004: { name: "Grå Mössa",     stock: 6  },
  SN1005: { name: "Vita Sneakers", stock: 0  },
};
// ===== Orders (i minnet) – enkel demo =====
let orders = []; // { id, productId, sku, name, qty, ts }

// Hjälpare: senaste 24h buckets (per timme)
function ordersPerHourLast24h(list) {
  const now = Date.now();
  const ONE_H = 60 * 60 * 1000;
  const start = now - 23 * ONE_H;
  const buckets = [];
  for (let i = 0; i < 24; i++) {
    const t = start + i * ONE_H;
    const hour = new Date(t);
    const count = list.filter(o => {
      const ts = typeof o.ts === 'number' ? o.ts : Date.parse(o.ts);
      return ts >= t && ts < t + ONE_H;
    }).reduce((sum, o) => sum + o.qty, 0);
    buckets.push({
      label: hour.toLocaleTimeString('sv-SE', { hour: '2-digit' }),
      count
    });
  }
  return buckets;
}

// Aggregera toppsäljare
function bestsellers(list) {
  const map = new Map(); // sku -> { id, sku, name, qty }
  for (const o of list) {
    const key = o.productId || o.sku;
    if (!map.has(key)) map.set(key, { id: key, sku: key, name: o.name, qty: 0 });
    map.get(key).qty += o.qty;
  }
  return [...map.values()].sort((a,b)=> b.qty - a.qty);
}

// Sammanfattning
app.get("/api/orders/summary", (req, res) => {
  const totalOrders = orders.reduce((sum, o) => sum + o.qty, 0);
  const latestOrder = orders[orders.length - 1] || null;
  const top = bestsellers(orders);
  const perHour = ordersPerHourLast24h(orders);
  res.json({
    success: true,
    totalOrders,
    latestOrder,
    bestsellers: top,        // [{id, sku, name, qty}]
    perHour                  // [{label: "13", count: 5}, ... 24 st]
  });
});

// ==== INVENTORY: SSE helpers ====
const sseClients = new Set();

function toItemsArray(invObj) {
  return Object.entries(invObj).map(([sku, v]) => ({
    id: sku,      // använd SKU som id
    sku,
    name: v.name,
    stock: v.stock
  }));
}

function sseBroadcast(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) res.write(data);
}

app.get("/api/inventory", (req, res) => {
  if ((req.query.format || '').toLowerCase() === 'object') {
    // ev. gammal klient
    return res.json(inventory);
  }
  res.json({ success: true, items: toItemsArray(inventory) });
});
app.post("/api/inventory/buy", (req, res) => {
  const { productId, quantity } = req.body || {};
  const product = inventory[productId];
  const qty = Number(quantity);
  if (!product) return res.status(404).json({ success: false, error: "Produkt hittades inte" });
  if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ success: false, error: "Ogiltig kvantitet" });
  if (product.stock < qty) return res.status(400).json({ success: false, error: "Ej tillräckligt i lager" });

  product.stock -= qty;
  const item = { id: productId, sku: productId, name: product.name, stock: product.stock };

  // 🆕 Logga ordern
  const order = { id: `ORD-${Date.now()}`, productId, sku: productId, name: product.name, qty, ts: Date.now() };
  orders.push(order);

  // Realtid
  sseBroadcast({ type: "stock", item });
  // 🆕 Skicka även order-event
  sseBroadcast({ type: "order", order });

  res.json({ success: true, item });
});

app.post("/api/inventory/return", (req, res) => {
  const { productId, quantity } = req.body || {};
  const product = inventory[productId];
  const qty = Number(quantity);
  if (!product) return res.status(404).json({ success: false, error: "Produkt hittades inte" });
  if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ success: false, error: "Ogiltig kvantitet" });

  product.stock += qty;
  const item = { id: productId, sku: productId, name: product.name, stock: product.stock };

  // (Returer loggas inte som "order" här, men du kan göra en separat "return"-händelse om du vill)
  sseBroadcast({ type: "stock", item });

  res.json({ success: true, item });
});


app.get("/api/inventory/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
   res.setHeader("X-Accel-Buffering", "no"); // <- för Nginx/Render
  if (res.flushHeaders) res.flushHeaders();

  // initial snapshot
  res.write(`data: ${JSON.stringify({ type: "snapshot", items: toItemsArray(inventory) })}\n\n`);

  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});


// Säker leverans av uppladdade bilder
// i säkra bildleveransen
const ALLOWED_IMAGE_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.jfif',
  '.heic', '.heif'
]);
app.get('/uploads/:filename', requireLogin, (req, res) => {
  const filename = path.basename(req.params.filename);
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_IMAGE_EXT.has(ext)) return res.status(400).send('Ogiltig filtyp');

  const filePath = path.join(__dirname, 'uploads', filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Filen finns inte');

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(filePath);
});

// 📤 Uppdatera profil (Multer först, sedan CSRF)
app.post("/api/profile/update", upload.single("profilePic"), csrfProtection, async (req, res) => {
  const { name, email, password, language, removeImage } = req.body;
  const userId = req.session?.user?._id;
  if (!userId) return res.status(401).json({ success: false, message: "Inte inloggad" });

  // Stark lösenordskoll – samma princip som tidigare
  function isPasswordStrong(pw, { email, name }) {
    if (typeof pw !== 'string' || pw.length < 10) return false;
    const classes = [/[A-Z]/.test(pw), /[a-z]/.test(pw), /\d/.test(pw), /[^A-Za-z0-9]/.test(pw)];
    if (classes.filter(Boolean).length < 4) return false;
    const lowered = pw.toLowerCase();
    const emailUser = (email || "").toLowerCase().split("@")[0];
    if (emailUser && lowered.includes(emailUser)) return false;
    if (name && lowered.includes((name || "").toLowerCase())) return false;
    try {
      const score = zxcvbn(pw).score; // 0–4
      if (score < 3) return false;
    } catch {
      return false;
    }
    return true;
  }

  try {
    const user = await Customer.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "Användare hittades inte" });

    if (name) user.name = name;
    if (email) user.email = email;
    if (language) user.language = language;

    if (password) {
      if (!isPasswordStrong(password, { email: user.email, name: user.name })) {
        return res.status(400).json({
          success: false,
          message: "Lösenordet är för svagt. Minst 10 tecken, stora/små bokstäver, siffra och specialtecken. Undvik namn/e-post."
        });
      }
      user.password = await bcrypt.hash(password, 10);
    }

    if (removeImage === "true" && user.profileImage) {
      const filename = path.basename(user.profileImage); // hanterar både '/uploads/x.png' och 'x.png'
      const oldPath = path.join(__dirname, "uploads", filename);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      user.profileImage = undefined;
    }

    if (req.file) {
      user.profileImage = "/uploads/" + req.file.filename; // serveras via GET /uploads/:filename
    }

    const updatedUser = await user.save();
    req.session.user = updatedUser; // uppdatera sessionen så UI kan spegla ny data
    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error("Fel vid profiluppdatering:", error);
    res.status(500).json({ success: false, message: "Misslyckades att uppdatera profil" });
  }
});

// ⬇️ Lägg till denna rad innan serverstart
app.use('/api/ads', require('./routes/adsRoutes'));


app.get('/api/user/profile', requireAuth, (req, res) => {
  const { name, email } = req.session.user;
  res.json({ name, email });
});

// 🔧 API-routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use("/api/invites", require("./routes/inviteRoutes"));
app.use('/api/invoices', require('./routes/invoiceRoutes'));
app.use('/api/analytics', require('./routes/analyticsRoutes'));
app.use('/api/support', require('./routes/support'));
app.use('/api/email', require('./routes/emailRoutes'));
app.use('/api/messages', require('./routes/messagesRoutes'));
app.use('/api/chat', require('./routes/chatRoutes'));
app.use('/api/customers', require('./routes/customers'));
app.use("/api/security", securityRouter);
app.use("/api/pageviews", require("./routes/pageviews"));
app.use("/api/pageviews", require("./routes/trackRoutes"));
app.use('/api/insights', insightsRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/ai-marknadsstudio', require('./routes/aiMarknadsstudio'));
app.use('/api/payments', require('./routes/payments'));

// Centralt felhanterings-middleware för uploads (Multer + övrigt)
app.use((err, req, res, next) => {
  // Multer-fel (t.ex. för stor fil)
  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'Filen är för stor. Max 5 MB.',
        code: 'LIMIT_FILE_SIZE'
      });
    }
    return res.status(400).json({
      success: false,
      message: 'Fel vid filuppladdning.',
      code: err.code || 'MULTER_ERROR'
    });
  }

  // Filtreringsfel från vår fileFilter (ogiltig MIME)
  if (err && /Ogiltig filtyp/i.test(err.message || '')) {
    return res.status(400).json({
      success: false,
      message: 'Ogiltig filtyp. Endast bildformat tillåts.',
      code: 'INVALID_MIME'
    });
  }

  // CSRF hanteras redan tidigare; övrigt → 500 JSON
  if (err) {
    console.error('❌ Oväntat fel:', err);
    return res.status(500).json({
      success: false,
      message: 'Serverfel. Försök igen senare.'
    });
  }

  next();
});

// 🚀 Starta servern
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`🚀 Servern körs på http://localhost:${PORT}`);
});
