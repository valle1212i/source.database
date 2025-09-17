// routes/profile.js
const express = require('express');
const router = express.Router();

const { requireAuth } = require('./security'); // använder session/cookie
const Customer = require('../models/Customer');

// GET /api/profile/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    // Hämta inloggad användare från auth-middleware (req.user) eller session
    const sessionUser = req.user || req.session?.user;
    if (!sessionUser || !sessionUser._id) {
      return res.status(401).json({ success: false, message: 'Inte inloggad' });
    }

    // Slå upp kunden
    const customer = await Customer.findById(sessionUser._id).lean();
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Kund hittades inte' });
    }

    // Bestäm tenant från DB (enda sanningen) och spara även i sessionen
    const tenant = customer.tenant ? String(customer.tenant).trim().toLowerCase() : null;
       if (tenant && req.session) {
            req.session.tenant = tenant;
            req.tenant = tenant; // 👈 direkt till request också
       }

    const language = customer.settings?.language || customer.language || null;

    // Svara med det frontend behöver
    return res.json({
      success: true,
      id: String(customer._id),
      name: customer.name || '',
      email: customer.email || '',
      role: customer.role || null,
      plan: customer.plan || null,
      tenant,                 // ⭐ viktigt för frontend
      language,
      profileImage: customer.profileImage || null,
      supportHistory: customer.supportHistory || []
    });
  } catch (err) {
    console.error('❌ /api/profile/me error:', err);
    return res.status(500).json({ success: false, message: 'Serverfel' });
  }
});

module.exports = router;
