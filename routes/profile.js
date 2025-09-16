// routes/profile.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('./security');   // din auth-middleware
const Customer = require('../models/Customer');

// GET /api/profile/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    // 1) Hämta användare från middleware/session
    const sessionUser = req.user || (req.session ? req.session.user : null);
    if (!sessionUser || !sessionUser._id) {
      return res.status(401).json({ success: false, message: 'Inte inloggad' });
    }

    // 2) Hämta kund från DB
    const customer = await Customer.findById(sessionUser._id).lean();
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Kund hittades inte' });
    }

    // 3) Plocka ut fält till frontend
    const language     = customer.settings?.language || customer.language || null;
    const profileImage = customer.profileImage || null;
    const tenant       = customer.tenant || sessionUser.tenant || null;  // <-- VIKTIGT

    // 4) SÄTT TENANTEN I SESSIONEN (så /api/messages kan läsa den server-side)
    if (req.session) {
      req.session.tenant = tenant || null;
      // synka även user-objektet i session (om du sparar det)
      if (req.session.user) req.session.user.tenant = tenant || null;
    }
    // och på req.user om du använder det vidare under requesten
    if (req.user) req.user.tenant = tenant || null;

    // 5) Svar till frontend – inkluderar tenant
    return res.json({
      success: true,
      id: String(customer._id),
      name: customer.name || '',
      email: customer.email || '',
      role: customer.role || null,
      plan: customer.plan || null,
      tenant,                                // <-- FRONTEND LÄSER DENNA
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
