// ── Imports ───────────────────────────────────────────────────────────────────
const express = require('express');
const cors = require("cors");
const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const session = require('express-session');
const MongoStore = require("connect-mongo");
const bcrypt = require('bcrypt');
const multer = require('multer');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const csrf = require('csurf');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const zxcvbn = require('zxcvbn');

// Modeller & routrar
const Customer = require('./models/Customer');
const inviteRoutes = require('./routes/inviteRoutes');
const insightsRoutes = require('./routes/insights');
const { router: securityRouter, requireAuth } = require("./routes/security");

// ── App & HTTP/Socket.IO ──────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1); // krävs på Render för secure cookies

const http = require('http').createServer(app);

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  "http://localhost:3000",
  "https://source-database.onrender.com",
  "https://admin-portal-rn5z.onrender.com",
  "https://vattentrygg.se",
  "https://www.vattentrygg.se",
];

const corsOptions = {
  origin(origin, callback) {
    // Tillåt requests utan Origin (curl/Postman/server-to-server)
    if (!origin) return callback(null, true);
    // Tillåt whitelistan
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Annars: ingen CORS-header (blockera från browser), men kasta inte Error
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Tenant"],
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions)); // handle preflight for any path



// ── Sessions (återanvänds av Socket.IO) ──────────────────────────────────────
app.use(cookieParser());
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

// Injektera req.user från session (innan routes)
app.use((req, res, next) => {
  if (req.session?.user) {
    const u = req.session.user;
    req.user = { _id: u._id, email: u.email, role: u.role, name: u.name };
  }
  next();
});

// ── Parsers & statics ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '200kb' }));
app.use(express.json({ limit: '200kb' }));

// ── Helmet (CSP i report-only) ───────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
      "https://apis.google.com",
      "https://cdn.jsdelivr.net",
      "https://cdnjs.cloudflare.com",
    ],
    styleSrc: [
      "'self'",
      "https://fonts.googleapis.com",
      "https://cdnjs.cloudflare.com",
      "'unsafe-inline'",
    ],
    fontSrc: [
      "'self'",
      "https://fonts.gstatic.com",
      "https://cdnjs.cloudflare.com",
    ],
    imgSrc: ["'self'", "data:", "https://*"],
    connectSrc: [
      "'self'",
      ...allowedOrigins,
    ],
    objectSrc: ["'none'"],
    upgradeInsecureRequests: [],
  },
  reportOnly: true,
}));

app.use(helmet.referrerPolicy({ policy: 'no-referrer' }));
if (process.env.NODE_ENV === 'production') {
  app.use(helmet.hsts({ maxAge: 15552000 }));
}

// ── Rate limiters ────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'För många inloggningsförsök. Försök igen senare.' }
});

// Begränsa skrivande inventory-åtgärder (5/10s per IP)
const inventoryLimiter = rateLimit({
  windowMs: 10 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'För många förfrågningar. Försök igen strax.' }
});

// ── CSRF (global med undantag) ───────────────────────────────────────────────
const csrfProtection = csrf({ cookie: true });
const CSRF_SKIP = new Set([
  '/api/profile/update',   // Multer först, lägger CSRF på själva rutten
  '/api/support/ticket',   // från gamla
  '/api/pageviews/track',  // extern tracker
  '/api/inventory/buy',
  '/api/inventory/return',
   '/api/messages',
]);

app.use((req, res, next) => {
  if (CSRF_SKIP.has(req.path)) return next();
  return csrfProtection(req, res, next);
});

// Endpoint för token
app.get('/csrf-token', (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// CSRF-fel
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ success: false, message: 'Ogiltig eller saknad CSRF-token' });
  }
  next(err);
});

// ── HTML-sidor (skyddade) ────────────────────────────────────────────────────
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login.html');
  next();
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/chatwindow.html', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'chatwindow.html')));
app.get('/customerportal.html', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'customerportal.html')));
app.get('/fakturor.html', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'fakturor.html')));
app.get('/rapporter.html', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'rapporter.html')));
app.get('/inventarier.html', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'inventarier.html')));
app.get('/kontakt.html', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'kontakt.html')));
app.get('/kunder.html', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'kunder.html')));

app.get('/admin-logins.html', requireLogin, (req, res) => {
  const user = req.session?.user;
  if (!user || user.role !== "admin") return res.status(403).send("Åtkomst nekad");
  res.sendFile(path.join(__dirname, 'public', 'admin-logins.html'));
});

// ── Uploads (multer) ─────────────────────────────────────────────────────────
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
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/png','image/jpeg','image/webp','image/gif','image/jfif','image/heic','image/heif'
    ];
    if (allowedMimes.includes(file.mimetype.toLowerCase())) cb(null, true);
    else cb(new Error('Ogiltig filtyp. Endast bilder tillåtna.'));
  }
});

// Säkra leverans av uppladdade bilder
const ALLOWED_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.jfif', '.heic', '.heif']);
app.get('/uploads/:filename', requireLogin, (req, res) => {
  const filename = path.basename(req.params.filename);
  const ext = path.extname(filename).toLowerCase();
  const filePath = path.join(__dirname, 'uploads', filename);

  if (!fs.existsSync(filePath)) return res.status(404).send('Filen finns inte');

  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (ALLOWED_IMAGE_EXT.has(ext)) {
    // Bilder → visa inline
    return res.sendFile(filePath);
  } else {
    // Annat → tvinga nedladdning
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.sendFile(filePath);
  }
});

// ── Profil-API (Multer → CSRF) ───────────────────────────────────────────────
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
  } catch { return false; }
  return true;
}

app.post("/api/profile/update", upload.single("profilePic"), csrfProtection, async (req, res) => {
  const { name, email, password, language, removeImage } = req.body;
  const userId = req.session?.user?._id;
  if (!userId) return res.status(401).json({ success: false, message: "Inte inloggad" });

  try {
    const user = await Customer.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "Användare hittades inte" });

    if (name) user.name = name;
    if (email) user.email = email;
    if (language) {
      user.language = language;
      if (user.settings) user.settings.language = language; // kompatibilitet med ev. schema
    }

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
      const filename = path.basename(user.profileImage);
      const oldPath = path.join(__dirname, 'uploads', filename);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      user.profileImage = undefined;
    }
    if (req.file) user.profileImage = '/uploads/' + req.file.filename;

    const updatedUser = await user.save();
    req.session.user = updatedUser;
    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error("Fel vid profiluppdatering:", error);
    res.status(500).json({ success: false, message: "Misslyckades att uppdatera profil" });
  }
});

// Kompatibla profil-GET endpoints
app.get("/api/user/profile", requireAuth, (req, res) => {
  const { name, email } = req.session.user;
  res.json({ name, email });
});
app.get("/api/profile/me", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false, message: "Inte inloggad" });
  try {
    const user = await Customer.findById(req.session.user._id).lean();
    if (!user) return res.status(404).json({ success: false, message: "Användare hittades inte" });
    const { _id, name, email, language, profileImage, supportHistory = [] } = user;
    res.json({ success: true, _id, name, email, language, profileImage, supportHistory });
  } catch (err) {
    console.error("❌ Fel vid hämtning av kundprofil:", err);
    res.status(500).json({ success: false, message: "Serverfel vid hämtning av profil" });
  }
});

// ── API-routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/authRoutes'));
app.use("/api/invites", inviteRoutes); // en mount
app.use('/api/invoices', require('./routes/invoiceRoutes'));
app.use('/api/analytics', require('./routes/analyticsRoutes'));
app.use('/api/support', require('./routes/support'));
app.use('/api/support/inbound', require('./routes/supportInbound')); // separerad
app.use('/api/email', require('./routes/emailRoutes'));
app.use('/api/payments', require('./routes/payments'));

let messagesRouter;
try {
  messagesRouter = require('./routes/messagesRoutes'); // ✅ plural
} catch {
  messagesRouter = require('./routes/messageRoutes');  // fallback om alias används
}
app.use('/api/messages', messagesRouter);
app.use('/api/chat', require('./routes/chatRoutes'));
app.use('/api/customers', require('./routes/customers'));
app.use("/api/security", securityRouter);
app.use('/api/insights', insightsRoutes);
app.use('/api/ai-marknadsstudio', require('./routes/aiMarknadsstudio'));
app.use('/api/ads', require('./routes/adsRoutes'));
app.use('/api/pageviews', require('./routes/pageviews')); // en router som hanterar /track & /summary

// Avvecklad legacy-login
app.post('/login', (req, res) => {
  return res.status(410).json({
    success: false,
    message: 'Endpoint avvecklad. Använd /api/auth/login.'
  });
});

// ── Inventory + Orders (SSE) ─────────────────────────────────────────────────
let inventory = {
  TS1001: { name: "Vit T-shirt",  stock: 0  },
  HD1002: { name: "Svart Hoodie", stock: 12 },
  KP1003: { name: "Blå Keps",     stock: 3  },
  GM1004: { name: "Grå Mössa",    stock: 6  },
  SN1005: { name: "Vita Sneakers", stock: 0 }
};
let orders = []; // { id, productId, sku, name, qty, ts }

function ordersPerHourLast24h(list) {
  const now = Date.now();
  const ONE_H = 60 * 60 * 1000;
  const start = now - 23 * ONE_H;
  const buckets = [];
  for (let i = 0; i < 24; i++) {
    const t = start + i * ONE_H;
    const hour = new Date(t);
    const count = list
      .filter(o => {
        const ts = typeof o.ts === 'number' ? o.ts : Date.parse(o.ts);
        return ts >= t && ts < t + ONE_H;
      })
      .reduce((sum, o) => sum + o.qty, 0);
    buckets.push({ label: hour.toLocaleTimeString('sv-SE', { hour: '2-digit' }), count });
  }
  return buckets;
}

function bestsellers(list) {
  const map = new Map();
  for (const o of list) {
    const key = o.productId || o.sku;
    if (!map.has(key)) map.set(key, { id: key, sku: key, name: o.name, qty: 0 });
    map.get(key).qty += o.qty;
  }
  return [...map.values()].sort((a,b)=> b.qty - a.qty);
}

app.get("/api/orders/summary", (req, res) => {
  const totalOrders = orders.reduce((sum, o) => sum + o.qty, 0);
  const latestOrder = orders[orders.length - 1] || null;
  const top = bestsellers(orders);
  const perHour = ordersPerHourLast24h(orders);
  res.json({ success: true, totalOrders, latestOrder, bestsellers: top, perHour });
});

const sseClients = new Set();
function toItemsArray(invObj) {
  return Object.entries(invObj).map(([sku, v]) => ({ id: sku, sku, name: v.name, stock: v.stock }));
}
function sseBroadcast(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) res.write(data);
}

app.get("/api/inventory", (req, res) => {
  if ((req.query.format || '').toLowerCase() === 'object') return res.json(inventory);
  res.json({ success: true, items: toItemsArray(inventory) });
});

app.post("/api/inventory/buy", inventoryLimiter, (req, res) => {
  const { productId, quantity } = req.body || {};
  const product = inventory[productId];
  const qty = Number(quantity);
  if (!product) return res.status(404).json({ success: false, error: "Produkt hittades inte" });
  if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ success: false, error: "Ogiltig kvantitet" });
  if (product.stock < qty) return res.status(400).json({ success: false, error: "Ej tillräckligt i lager" });

  product.stock -= qty;
  const item = { id: productId, sku: productId, name: product.name, stock: product.stock };

  const order = { id: `ORD-${Date.now()}`, productId, sku: productId, name: product.name, qty, ts: Date.now() };
  orders.push(order);

  sseBroadcast({ type: "stock", item });
  sseBroadcast({ type: "order", order });

  res.json({ success: true, item });
});

app.post("/api/inventory/return", inventoryLimiter, (req, res) => {
  const { productId, quantity } = req.body || {};
  const product = inventory[productId];
  const qty = Number(quantity);
  if (!product) return res.status(404).json({ success: false, error: "Produkt hittades inte" });
  if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ success: false, error: "Ogiltig kvantitet" });

  product.stock += qty;
  const item = { id: productId, sku: productId, name: product.name, stock: product.stock };
  sseBroadcast({ type: "stock", item });
  res.json({ success: true, item });
});

app.get("/api/inventory/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (res.flushHeaders) res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: "snapshot", items: toItemsArray(inventory) })}\n\n`);
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

// ── Socket.IO (med delad session + auth) ─────────────────────────────────────
const io = require('socket.io')(http, { cors: { origin: allowedOrigins, credentials: true }});
app.set('io', io);

// Dela Express-session med Socket.IO
io.engine.use(sessionMiddleware);

// Auth-guard: använd delad session och minimera PII
io.use((socket, next) => {
  try {
    const u = socket.request?.session?.user;
    if (!u?._id) return next(new Error('unauthorized'));

    // Exponera endast minsta möjliga: id, roll, ev. namn
    socket.data.user = Object.freeze({
      _id: u._id,
      role: u.role || 'user',
      name: typeof u.name === 'string' ? u.name.slice(0, 100) : ''
    });

    return next();
  } catch (err) {
    return next(new Error('unauthorized'));
  }
});

io.on("connection", (socket) => {
  const user = socket.data?.user;
  console.log("🟢 Socket.IO anslutning", { userId: user?._id, role: user?.role });

    // Event-whitelist och säkra bindningar
  const ALLOWED_EVENTS = new Set(['join_site', 'startSession', 'sendMessage', 'endSession']);

  function safeOn(event, handler) {
    if (!ALLOWED_EVENTS.has(event)) {
      console.warn(`🚫 Försök att binda otillåtet event: ${event}`);
      return;
    }
    socket.on(event, handler);
  }

  // Avvisa okända inkommande events (probing/abuse)
  socket.onAny((event) => {
    if (!ALLOWED_EVENTS.has(event)) {
      console.warn(`🚫 Blockerat otillåtet inkommande event: ${event}`);
      // mild reaktion: ignorera. Alternativ: socket.disconnect(true)
    }
  });

  // live-rum för sidvisningar
  safeOn('join_site', (siteId) => {
    if (typeof siteId === 'string' && siteId.length <= 128) {
      socket.join(`site:${siteId}`);
    }
  });

  // Ny session – sanera & broadcasta minimal data
  safeOn("startSession", (sessionData = {}) => {
    const sessionId = typeof sessionData.sessionId === "string" ? sessionData.sessionId : "";
    if (!/^[A-Za-z0-9._-]{8,128}$/.test(sessionId)) return;
    const startedAt = sessionData.startedAt ? new Date(sessionData.startedAt).toISOString() : new Date().toISOString();
    io.emit("newSession", { sessionId, startedAt });
  });

  // Meddelanden – sanera innehåll och sätt sender från roll
  safeOn("sendMessage", (msg = {}) => {
    const raw = typeof msg.message === "string" ? msg.message : "";
    let message = raw.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    if (!message) return;
    if (message.length > 2000) message = message.slice(0, 2000);
    const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : "";
    if (!/^[A-Za-z0-9._-]{8,128}$/.test(sessionId)) return;
    const sender = user?.role === "admin" ? "admin" : "customer";
    io.emit("newMessage", { message, sender, timestamp: new Date().toISOString(), sessionId });
  });

  // Avsluta session – spara minimal data till admin-API (med env-styrning)
  safeOn("endSession", async (payload = {}) => {
    try {
      const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
      if (!/^[A-Za-z0-9._-]{8,128}$/.test(sessionId)) return;

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

      const caseData = {
        sessionId,
        startedAt: payload.startedAt ? new Date(payload.startedAt).toISOString() : undefined,
        endedAt: new Date().toISOString(),
        messages
      };
      Object.keys(caseData).forEach(k => caseData[k] === undefined && delete caseData[k]);

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

// ── MongoDB & cron ───────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('🟢 Ansluten till MongoDB Atlas');
    require('./cron/insightCron');
  })
  .catch(err => console.error('🔴 Fel vid MongoDB:', err));

// ── Enkel övervakning av många felkoder ──────────────────────────────────────
const failCounts = new Map();
const WINDOW_MS = 60 * 1000; // 1 minut
const THRESHOLD = 10;

app.use((req, res, next) => {
  const end = res.end;
  res.end = function (...args) {
    try {
      const status = res.statusCode;
      if ([401, 403, 429].includes(status)) {
        const key = req.ip;
        const now = Date.now();
        const arr = failCounts.get(key) || [];
        const recent = arr.filter(ts => now - ts < WINDOW_MS);
        recent.push(now);
        failCounts.set(key, recent);
        if (recent.length >= THRESHOLD) {
          console.warn(`⚠️ Misstänkt aktivitet från ${key}: ${recent.length} felkoder inom ${WINDOW_MS / 1000}s`);
        }
      }
    } catch (err) {
      console.error("❌ Fel i övervakningslogg:", err);
    }
    end.apply(this, args);
  };
  next();
});

// ── Central felhantering (Multer + övrigt) ───────────────────────────────────
app.use((err, req, res, next) => {
  // Multer-fel
  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'Filen är för stor. Max 5 MB.', code: 'LIMIT_FILE_SIZE' });
    }
    return res.status(400).json({ success: false, message: 'Fel vid filuppladdning.', code: err.code || 'MULTER_ERROR' });
  }
  // Filtreringsfel (ogiltig MIME)
  if (err && /Ogiltig filtyp/i.test(err.message || '')) {
    return res.status(400).json({ success: false, message: 'Ogiltig filtyp. Endast bildformat tillåts.', code: 'INVALID_MIME' });
  }
  if (err) {
    console.error('❌ Oväntat fel:', err);
    return res.status(500).json({ success: false, message: 'Serverfel. Försök igen senare.' });
  }
  next();
});

// ── Server start ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`🚀 Servern körs på http://localhost:${PORT}`);
});
