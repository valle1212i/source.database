const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const LoginEvent = require('../models/LoginEvent');
const zxcvbn = require('zxcvbn');
const csrf = require('csurf');
const speakeasy = require('speakeasy');
const crypto = require('crypto');


// skapar en token och lägger den i/validerar mot cookie
const csrfProtection = csrf({ cookie: true });

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,     // 15 minuter
  max: 10,                      // max 10 försök per IP
  standardHeaders: true,        // skickar RateLimit-* headers
  legacyHeaders: false,
  message: { success: false, message: 'För många inloggningsförsök. Försök igen senare.' }
});
const twofaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,                  // lite högre än lösenordets steg
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'För många verifieringsförsök. Försök igen senare.' }
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

        // 🔐 Om 2FA är aktivt => regenerera session och be om steg 2
        if (user.twofa?.enabled) {
          await new Promise((resolve, reject) => {
            req.session.regenerate(err => (err ? reject(err) : resolve()));
          });
    
          // Rensa ev. tidigare user-info för säkerhets skull
          try { delete req.session.user; } catch (_) {}
    
          // Spara bara ett "pre-2FA"-läge i sessionen, INTE full user
          req.session.pre2fa = {
            userId: user._id.toString(),
            methods: Array.isArray(user.twofa.methods) && user.twofa.methods.length ? user.twofa.methods : ['totp'],
            ts: Date.now()
          };
    
          return res.status(200).json({
            success: true,
            need2fa: true,
            methods: req.session.pre2fa.methods
          });
        }
    
        // Ingen 2FA: slutför inloggning som tidigare (regenerate + set user)
        await new Promise((resolve, reject) => {
          req.session.regenerate(err => (err ? reject(err) : resolve()));
        });
    
        req.session.user = {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role || "user",
          profileImage: user.profileImage,
          settings: user.settings || {}
        };
    
        console.log("✅ Inloggad:", email);
        const ip = (req.headers['x-forwarded-for']?.split(',')[0] || '').trim() || req.socket.remoteAddress || '';
        const device = req.headers['user-agent'] || '';
        await LoginEvent.create({ userId: user._id, ip, device });
    
        return res.status(200).json({ success: true, message: '✅ Inloggning lyckades!' });     
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
// 🔐 Steg 2 av inloggning: verifiera 2FA (TOTP eller backupkod)
router.post('/login/2fa', twofaLimiter, csrfProtection, async (req, res) => {
  try {
    const pre = req.session?.pre2fa;
    if (!pre?.userId) {
      return res.status(401).json({ success: false, message: 'Ingen 2FA-session. Logga in igen.' });
    }

    const { token, code } = req.body || {};
    const inputRaw = (token || code || '').toString().trim().toUpperCase();
    if (!inputRaw) {
      return res.status(400).json({ success: false, message: 'Saknar 2FA-kod' });
    }

    const user = await Customer.findById(pre.userId);
    if (!user || !user.twofa?.enabled) {
      return res.status(401).json({ success: false, message: '2FA inte aktivt för användaren' });
    }

    let ok = false;

    // 1) TOTP (om secret finns)
    if (user.twofa.secret) {
      ok = speakeasy.totp.verify({
        secret: user.twofa.secret,
        encoding: 'base32',
        token: inputRaw,
        window: 1
      });
    }

    // 2) Backupkod (om TOTP misslyckades)
    if (!ok && Array.isArray(user.twofa.backupCodes) && user.twofa.backupCodes.length) {
      const hash = crypto.createHash('sha256').update(inputRaw).digest('hex');
      const idx = user.twofa.backupCodes.findIndex(h => h === hash);
      if (idx !== -1) {
        ok = true;
        // konsumerar backupkoden: ta bort den
        user.twofa.backupCodes.splice(idx, 1);
        await user.save();
      }
    }

    if (!ok) {
      return res.status(401).json({ success: false, message: 'Felaktig 2FA-kod' });
    }

    // ✅ Klart: skapa riktig session och logga händelsen
    await new Promise((resolve, reject) => {
      req.session.regenerate(err => (err ? reject(err) : resolve()));
    });

    req.session.user = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role || "user",
      profileImage: user.profileImage,
      settings: user.settings || {}
    };

    // rensa pre2fa
    try { delete req.session.pre2fa; } catch (_) {}

    const ip = (req.headers['x-forwarded-for']?.split(',')[0] || '').trim() || req.socket.remoteAddress || '';
    const device = req.headers['user-agent'] || '';
    await LoginEvent.create({ userId: user._id, ip, device });

    return res.status(200).json({ success: true, message: '✅ 2FA verifierad – inloggad!' });

  } catch (err) {
    console.error('❌ Fel vid 2FA-verifiering:', err);
    return res.status(500).json({ success: false, message: '❌ Serverfel vid 2FA.' });
  }
});

module.exports = router;
