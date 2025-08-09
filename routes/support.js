// routes/support.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('./security');
const Customer = require('../models/Customer');
const { handleCustomerQuestion } = require('../aiSupport');

// 🔹 Skapa ett nytt supportärende
// POST /api/support/create
// body: { topic: string, status?: "Öppen" | "Pågår" | "Stängd", caseId?: string, date?: string }
router.post('/create', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user._id;
    const customer = await Customer.findById(userId);
    if (!customer) return res.status(404).json({ success: false, message: 'Kund hittades inte' });

    const {
      topic = '',
      status = 'Öppen',
      caseId,
      date
    } = req.body;

    const entry = {
      caseId: caseId || Math.random().toString(36).slice(-6).toUpperCase(),
      date: date ? new Date(date) : new Date(),
      topic,
      status
    };

    customer.supportHistory.push(entry);
    await customer.save();

    res.json({ success: true, entry, supportHistory: customer.supportHistory });
  } catch (err) {
    console.error('❌ Fel vid skapande av supportärende:', err);
    res.status(500).json({ success: false, message: 'Misslyckades att skapa supportärende' });
  }
});

// 🔹 Hämta inloggad användares supporthistorik
// GET /api/support/history
router.get('/history', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user._id;
    const customer = await Customer.findById(userId).lean();
    if (!customer) return res.status(404).json({ success: false, message: 'Kund hittades inte' });

    res.json({
      success: true,
      supportHistory: customer.supportHistory || []
    });
  } catch (err) {
    console.error('❌ Fel vid hämtning av supporthistorik:', err);
    res.status(500).json({ success: false, message: 'Kunde inte hämta historik' });
  }
});

// (befintlig) AI-fråga – behåll
router.post('/ask', async (req, res) => {
  const { message } = req.body;
  const user = req.session.user;

  console.log("🔍 Fråga från frontend:", message);
  console.log("👤 Inloggad användare:", user);

  if (!user || !user._id) {
    console.log("❌ Ingen inloggad användare");
    return res.status(401).json({ error: 'Ingen användare inloggad' });
  }

  try {
    const reply = await handleCustomerQuestion(user, message);
    console.log("✅ GPT-svar:", reply);
    res.json({ reply });
  } catch (err) {
    console.error("❌ Fel vid GPT-anrop:", err);
    res.status(500).json({ error: 'AI-svar misslyckades' });
  }
});

module.exports = router;
