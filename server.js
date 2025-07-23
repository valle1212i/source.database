const express = require('express');
const cors = require("cors");
const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const Customer = require('./models/Customer');

const multer = require('multer');
const fs = require('fs');

// Konfigurera lagringsplats för profilbilder
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

dotenv.config();
const app = express();
const http = require('http').createServer(app);
const allowedOrigins = [
  "http://localhost:3000",
  "https://source-database.onrender.com",
  "https://admin-portal-production-a9a5.up.railway.app",
];
const io = require('socket.io')(http, {
  cors: {
    origin: allowedOrigins,
    credentials: true
  }
});
app.use(cors({
  origin: function (origin, callback) {
    // Tillåt även requests utan origin (t.ex. curl eller mobilappar)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS-fel: Ursprung inte tillåtet"));
    }
  },
  credentials: true
}));
// Socket.IO för realtidskommunikation

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: 'source_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    sameSite: 'lax',     // Viktigt för att skicka cookies via fetch
    secure: false        // Sätt till true om du kör med HTTPS
  }
}));


mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('🟢 Ansluten till MongoDB Atlas'))
  .catch(err => console.error('🔴 Fel vid MongoDB:', err));

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login.html');
  }
  next();
}
app.get('/chatwindow.html', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chatwindow.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await Customer.findOne({ email });
    if (!user) return res.status(401).send('❌ Fel e-post eller lösenord');

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).send('❌ Fel e-post eller lösenord');
    
    // Efter lyckad inloggning:
    req.session.user = { name: user.name, email: user.email };

    req.session.user = user;
    res.redirect('/customerportal.html');
  } catch (err) {
    console.error('❌ Fel vid inloggning:', err);
    res.status(500).send('Ett fel uppstod vid inloggning.');
  }
});

app.get('/customerportal.html', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'customerportal.html'));
});

app.get('/fakturor.html', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'fakturor.html'));
});

app.get('/rapporter.html', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'rapporter.html'));
});

app.get('/inventarier.html', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'inventarier.html'));
});

app.get('/kontakt.html', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'kontakt.html'));
});

app.get('/kunder.html', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'kunder.html'));
});

app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error("Fel vid utloggning:", err);
      return res.status(500).json({ success: false, message: "Kunde inte logga ut." });
    }

    res.clearCookie('connect.sid'); // 🧹 Viktigt!
    res.json({ success: true });    // ✅ Fungerar med fetch()
  });
});



// 🔧 API-routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/invoices', require('./routes/invoiceRoutes'));
app.use('/api/analytics', require('./routes/analyticsRoutes'));
app.use('/api/support', require('./routes/support'));
app.use('/api/email', require('./routes/emailRoutes'));
app.use('/api/messages', require('./routes/messagesRoutes'));
app.use('/api/chat', require('./routes/chatRoutes'));
app.use('/api/customers', require('./routes/customers'));


// 📦 Simulerat inventarielager
let inventory = {
  TS1001: { name: "Vit T-shirt", stock: 0 },
  HD1002: { name: "Svart Hoodie", stock: 12 },
  KP1003: { name: "Blå Keps", stock: 3 },
  GM1004: { name: "Grå Mössa", stock: 6 },
  SN1005: { name: "Vita Sneakers", stock: 0 },
};

app.get("/api/inventory", (req, res) => {
  res.json(inventory);
});

app.post("/api/inventory/buy", (req, res) => {
  const { productId, quantity } = req.body;
  const product = inventory[productId];
  const qty = Number(quantity);

  if (!product) return res.status(404).json({ error: "Produkt hittades inte" });
  if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: "Ogiltig kvantitet" });
  if (product.stock < qty) return res.status(400).json({ error: "Ej tillräckligt i lager" });

  product.stock -= qty;
  res.json({ success: true, productId, stock: product.stock });
});

app.post("/api/inventory/return", (req, res) => {
  const { productId, quantity } = req.body;
  const product = inventory[productId];
  const qty = Number(quantity);

  if (!product) return res.status(404).json({ error: "Produkt hittades inte" });
  if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: "Ogiltig kvantitet" });

  product.stock += qty;
  res.json({ success: true, productId, stock: product.stock });
});

// Auth middleware – beroende på om du använder sessions eller JWT
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    next();
  } else {
    res.status(401).json({ error: "Inte inloggad" });
  }
}

// Endpoint som returnerar användarens namn
app.get('/api/user/profile', requireAuth, (req, res) => {
  const { name, email } = req.session.user; // eller req.user beroende på din auth-lösning
  res.json({ name, email });
});

// 🧠 === Socket.IO-anslutning ===
io.on("connection", (socket) => {
  console.log("🟢 En användare anslöt via Socket.IO");

  socket.on("sendMessage", (msg) => {
    console.log("✉️ Meddelande mottaget:", msg);
    io.emit("newMessage", msg);
  });

  socket.on("disconnect", () => {
    console.log("🔴 Användare frånkopplad");
  });
});
// === 🔧 Uppdatera användarprofil med bild (och stöd för borttagning) ===
app.post("/api/profile/update", upload.single("profilePic"), async (req, res) => {
  const { name, email, password, language, removeImage } = req.body;
  const userId = req.session?.user?._id;

  if (!userId) {
    return res.status(401).json({ success: false, message: "Inte inloggad" });
  }

  try {
    const user = await Customer.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "Användare hittades inte" });

    if (name) user.name = name;
    if (email) user.email = email;
    if (language) user.settings.language = language;
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      user.password = hashedPassword;
    }

    // 🗑️ Om användaren vill ta bort befintlig profilbild
    if (removeImage === "true" && user.profileImage) {
      const oldPath = path.join(__dirname, 'public', user.profileImage);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
      user.profileImage = undefined;
    }

    // 🖼️ Om ny bild laddas upp
    if (req.file) {
      user.profileImage = '/uploads/' + req.file.filename;
    }

    const updatedUser = await user.save();

    req.session.user = updatedUser;

    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error("Fel vid profiluppdatering:", error);
    res.status(500).json({ success: false, message: "Misslyckades att uppdatera profil" });
  }
});


// === 🔍 Hämta aktuell inloggad användare med profilbild ===
app.get("/api/profile/me", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "Inte inloggad" });
  }

  const { name, email, language, profileImage } = req.session.user;
  res.json({ success: true, name, email, language, profileImage });
});


// 🚀 Starta server
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`🚀 Servern körs på http://localhost:${PORT}`);
});
