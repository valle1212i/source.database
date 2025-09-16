// routes/profile.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('./security'); // använder session/cookie
const Customer = require('../models/Customer');

// GET /api/profile/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    // Säker session-källa
    const sessionUser = req.user || req.session?.user;
    if (!sessionUser) {
      return res.status(401).json({ success: false, message: 'Inte inloggad' });
    }

    // Hämta kundprofilen från DB
    const customer = await Customer.findById(sessionUser._id).lean();
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Kund hittades inte' });
    }

    // Språk/profilbild
    const language = customer.settings?.language || customer.language || null;
    const profileImage = customer.profileImage || null;

    // 🔴 VIKTIGT: exponera tenant (från kundposten i DB, eller fallback till session)
    const tenant = customer.tenant || sessionUser.tenant || null;

    // Svara med allt frontenden behöver
    return res.json({
      success: true,
      id: String(customer._id),
      name: customer.name || '',
      email: customer.email || '',
      role: customer.role || null,
      plan: customer.plan || null,
      tenant,                     // <- det här saknades
      language,
      profileImage,
      supportHistory: customer.supportHistory || []
    });
  } catch (err) {
    console.error('❌ Fel i /api/profile/me:', err);
    return res.status(500).json({ success: false, message: 'Serverfel' });
  }
});

module.exports = router;
