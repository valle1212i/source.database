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
    const newUser = new Customer({ name, email, password: hashedPassword });
    await newUser.save();

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
      return res.status(401).json({ success: false, message: '❌ Fel e-post eller lösenord' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: '❌ Fel e-post eller lösenord' });
    }

    req.session.user = user;
    res.status(200).json({ success: true, message: '✅ Inloggning lyckades!' });
  } catch (err) {
    console.error('❌ Fel vid inloggning:', err);
    res.status(500).json({ success: false, message: '❌ Serverfel vid inloggning.' });
  }
});

module.exports = router;
