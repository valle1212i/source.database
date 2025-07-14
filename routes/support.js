const express = require('express');
const router = express.Router();
const { handleCustomerQuestion } = require('../aiSupport');

router.post('/ask', async (req, res) => {
  const { message } = req.body;
  const user = req.session.user;

  // 🔍 Loggar för felsökning
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
