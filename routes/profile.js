// routes/profile.js
const express = require('express');
const router = express.Router();

// Auth-middleware (session/cookie-baserad)
const { requireAuth } = require('./security');
const Customer = require('../models/Customer');

// GET /api/profile/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    // 1) Hämta inloggat användar-ID från req.user eller session
    const userId =
      (req.user && req.user._id) ||
      (req.session && req.session.user && req.session.user._id);

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Inte inloggad' });
    }

    // 2) Slå upp kunden
    const customer = await Customer.findById(userId).lean();
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Kund hittades inte' });
    }

    // 3) Bestäm tenant (DB → session → header)
    const tenantFromDb =
      customer.tenant ? String(customer.tenant).trim().toLowerCase() : null;
    const tenantFromSession =
      req.session && req.session.tenant
        ? String(req.session.tenant).trim().toLowerCase()
        : null;
    const tenantFromHeader =
      req.get('X-Tenant') ? String(req.get('X-Tenant')).trim().toLowerCase() : null;

    const tenant = tenantFromDb || tenantFromSession || tenantFromHeader || null;

    // 4) Spegla till session så servern kan använda den i efterföljande requests
    if (tenant && req.session) {
      req.session.tenant = tenant;
    }

    // 5) Svara med profilinfo som frontenden behöver
    return res.json({
      success: true,
      id: String(customer._id),
      name: customer.name || '',
      email: customer.email || '',
      role: customer.role || null,
      plan: customer.plan || null,
      tenant, // <- Viktigt: skicka alltid tillbaka om vi känner till den
      language: (customer.settings && customer.settings.language) || customer.language || null,
      profileImage: customer.profileImage || null,
      supportHistory: customer.supportHistory || []
    });
  } catch (err) {
    console.error('❌ Fel i /api/profile/me:', err);
    return res.status(500).json({ success: false, message: 'Serverfel' });
  }
});

module.exports = router;
