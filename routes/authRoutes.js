const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const bcrypt = require('bcrypt');

// 📝 Registrera ny användare
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
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

// 🔑 Logga in användare
router.post('/login', async (req, res) => {
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
    res.status(200).json({ success: true, message: '✅ Inloggning lyckades!' });
  } catch (err) {
    console.error('❌ Fel vid inloggning:', err);
    res.status(500).json({ success: false, message: '❌ Serverfel vid inloggning.' });
  }
});

router.get('/logout', (req, res) => {
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
    res.json({ success: true, name, email, profileImage });
  } else {
    res.status(401).json({ success: false, message: "Inte inloggad" });
  }
});

module.exports = router;
