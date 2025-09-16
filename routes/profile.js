// routes/profile.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('./security');
const Customer = require('../models/Customer');

// GET /api/profile/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const sessionUser = req.user || req.session?.user;
    if (!sessionUser) {
      return res.status(401).json({ success: false, message: 'Inte inloggad' });
    }

    const customer = await Customer.findById(sessionUser._id).lean();
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Kund hittades inte' });
    }

    const language = customer.settings?.language || customer.language || null;
    const profileImage = customer.profileImage || null;

    // Viktigt: skicka tillbaka tenant till frontend
    const tenant = customer.tenant || sessionUser.tenant || null;

    return res.json({
      success: true,
      id: String(customer._id),
      name: customer.name || '',
      email: customer.email || '',
      role: customer.role || null,
      plan: customer.plan || null,
      tenant,                // <-- frontend läser denna
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
