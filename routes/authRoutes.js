const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const LoginEvent = require('../models/LoginEvent');
const zxcvbn = require('zxcvbn');
const csrf = require('csurf');

// skapar en token och lägger den i/validerar mot cookie
const csrfProtection = csrf({ cookie: true });

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,     // 15 minuter
  max: 10,                      // max 10 försök per IP
  standardHeaders: true,        // skickar RateLimit-* headers
  legacyHeaders: false,
  message: { success: false, message: 'För många inloggningsförsök. Försök igen senare.' }
});


// 📝 Registrera ny användare
router.post('/register', async (req, res) => {
  return res.status(403).json({ success: false, message: 'Registrering är avstängd. Använd inbjudningslänk.' });
  const { name, email, password } = req.body;
function isPasswordStrong(pw, { email, name }) {
    if (typeof pw !== 'string' || pw.length < 10) return false;

    const classes = [
      /[A-Z]/.test(pw),
      /[a-z]/.test(pw),
      /\d/.test(pw),
      /[^A-Za-z0-9]/.test(pw)
    ];
    if (classes.filter(Boolean).length < 4) return false;

    const lowered = pw.toLowerCase();
    const emailUser = (email || '').toLowerCase().split('@')[0];
    if (emailUser && lowered.includes(emailUser)) return false;
    if (name && lowered.includes(name.toLowerCase())) return false;

    const score = zxcvbn(pw).score; // 0–4
    return score >= 3;
  }

  if (!isPasswordStrong(password, { email, name })) {
    return res.status(400).json({
      success: false,
      message: "Lösenordet är för svagt. Använd minst 10 tecken, alla fyra teckentyper, och undvik att inkludera namn/e-post."
    });
  }
  try {
    const existingUser = await Customer.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: '⚠️ E-post redan registrerad.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new Customer({
      name,
      email,
      password: hashedPassword,
      role: "admin" // 🔐 Alla som registrerar sig via formulär blir admin
});
    await newUser.save();

    console.log("✅ Ny användare registrerad:", newUser.email);
    res.status(201).json({ success: true, message: '✅ Användare skapad!' });
  } catch (err) {
    console.error('❌ Fel vid registrering:', err);
    res.status(500).json({ success: false, message: '❌ Serverfel vid registrering.' });
  }
});

// Hämta CSRF-token för klient/curl
router.get('/csrf', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// 🔑 Logga in användare
router.post('/login', loginLimiter, csrfProtection, async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await Customer.findOne({ email });
    if (!user) {
      console.warn("❌ Inloggning: användare ej hittad:", email);
      return res.status(401).json({ success: false, message: '❌ Fel e-post eller lösenord' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.warn("❌ Inloggning: lösenord matchar ej för:", email);
      return res.status(401).json({ success: false, message: '❌ Fel e-post eller lösenord' });
    }

    // 🔐 Regenerera session för att förhindra session fixation
    await new Promise((resolve, reject) => {
      req.session.regenerate(err => {
        if (err) return reject(err);
        resolve();
      });
    });    

    // ✅ Spara endast det som behövs i sessionen
    req.session.user = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role || "user",
      profileImage: user.profileImage,
      settings: user.settings || {}
    };

    console.log("✅ Inloggad:", email);
    // 📊 Logga enhet (IP + User-Agent) efter lyckad inloggning
const ip = (req.headers['x-forwarded-for']?.split(',')[0] || '').trim() || req.socket.remoteAddress || '';
const device = req.headers['user-agent'] || '';
await LoginEvent.create({ userId: user._id, ip, device });
    res.status(200).json({ success: true, message: '✅ Inloggning lyckades!' });
  } catch (err) {
    console.error('❌ Fel vid inloggning:', err);
    res.status(500).json({ success: false, message: '❌ Serverfel vid inloggning.' });
  }
});

router.post('/logout', (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, message: 'Inte inloggad' });
  }
  req.session.destroy(err => {
    if (err) {
      console.error("Utloggning misslyckades:", err);
      return res.status(500).json({ success: false });
    }
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

router.get('/me', (req, res) => {
  if (req.session && req.session.user) {
    const { name, email, profileImage } = req.session.user;
    return res.json({ success: true, name, email, profileImage });
  } else {
    console.warn("⚠️ Ingen användare inloggad – session saknas");
    return res.status(401).json({ success: false, message: "Inte inloggad" });
  }
});

module.exports = router;
