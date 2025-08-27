const express = require('express');
const cors = require("cors");
const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');
const result = dotenv.config();
const bodyParser = require('body-parser');
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


dotenv.config();
const app = express();
app.set('trust proxy', 1); // ⬅️ KRÄVS på Render för att secure cookies ska funka
const http = require('http').createServer(app);

// CSRF-skydd via cookies
const csrfProtection = csrf({ cookie: true });



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
    const allowedMimes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/jfif'];
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
app.use(session({
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

}));

// 🧱 Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
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

// Aktivera CSRF-skydd (måste ligga efter cookieParser och före routes)
app.use(csrfProtection);

// Ge klienten ett sätt att hämta token
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
const axios = require('axios'); // ⬅️ LÄGG TILL ÖVERST om inte finns

io.on("connection", (socket) => {
  console.log("🟢 En användare anslöt via Socket.IO");

  // 🆕 När ny session startar (efter frågor)
  socket.on("startSession", (sessionData) => {
    console.log("🟡 Ny sessionsstart:", sessionData);
    
    // Broadcast till alla (inkl. adminportalen)
    io.emit("newSession", sessionData);
  });

  // 📨 När kunden skickar meddelande
  socket.on("sendMessage", (msg) => {
    console.log("✉️ Meddelande mottaget:", msg);
    io.emit("newMessage", msg); // Broadcast till alla
  });

  // ✅ När kunden avslutar chatten – skicka till adminportalens case-API
  socket.on("endSession", async (fullSession) => {
    try {
      const response = await axios.post(
        "https://admin-portal-rn5z.onrender.com/api/cases",
        fullSession
      );
      console.log("💾 Chatten sparad till adminportal ✅", response.status);
    } catch (err) {
      console.error("❌ Kunde inte spara chatten till adminportal:", err.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 Användare frånkopplad");
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
const ALLOWED_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.jfif']);
app.get('/uploads/:filename', requireLogin, (req, res) => {
  const filename = path.basename(req.params.filename);
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_IMAGE_EXT.has(ext)) return res.status(400).send('Ogiltig filtyp');

  const filePath = path.join(__dirname, 'uploads', filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Filen finns inte');

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type(filename);
  res.sendFile(filePath);
});

// 📤 Uppdatera profil
app.post("/api/profile/update", upload.single("profilePic"), async (req, res) => {
  const { name, email, password, language, removeImage } = req.body;
  const userId = req.session?.user?._id;
  if (!userId) return res.status(401).json({ success: false, message: "Inte inloggad" });

  try {
    const user = await Customer.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "Användare hittades inte" });
    if (name) user.name = name;
    if (email) user.email = email;
    if (language) user.settings.language = language;
        if (password) {
      const isValid = typeof password === 'string'
        && password.length >= 8
        && /[A-Z]/.test(password)     // minst en stor bokstav
        && /[a-z]/.test(password)     // minst en liten bokstav
        && /\d/.test(password)        // minst en siffra
        && /[^A-Za-z0-9]/.test(password); // minst ett specialtecken

      if (!isValid) {
        return res.status(400).json({
          success: false,
          message: "Lösenordet måste vara minst 8 tecken och innehålla stora och små bokstäver, siffror och specialtecken."
        });
      }

      user.password = await bcrypt.hash(password, 10);
    }
    if (removeImage === "true" && user.profileImage) {
    // Stöder både "/uploads/fil.png" och "fil.png"
      const filename = path.basename(user.profileImage);
      const oldPath = path.join(__dirname, 'uploads', filename);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      user.profileImage = undefined;
}
    // Behåll lagrat värde som "/uploads/<fil>" för kompatibilitet.
    // Vi serverar detta via en kontrollerad GET-route i nästa steg.
    if (req.file) user.profileImage = '/uploads/' + req.file.filename;

    const updatedUser = await user.save();
    req.session.user = updatedUser;
    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error("Fel vid profiluppdatering:", error);
    res.status(500).json({ success: false, message: "Misslyckades att uppdatera profil" });
  }
});

// 👤 Hämta inloggad användare + supporthistorik
app.get("/api/profile/me", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false, message: "Inte inloggad" });

  try {
    const user = await Customer.findById(req.session.user._id).lean();
    if (!user) return res.status(404).json({ success: false, message: "Användare hittades inte" });

    const { _id, name, email, language, profileImage, supportHistory = [] } = user;

    res.json({
      success: true,
      _id,
      name,
      email,
      language,
      profileImage,
      supportHistory
    });
  } catch (err) {
    console.error("❌ Fel vid hämtning av kundprofil:", err);
    res.status(500).json({ success: false, message: "Serverfel vid hämtning av profil" });
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

// 🚀 Starta servern
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`🚀 Servern körs på http://localhost:${PORT}`);
});
