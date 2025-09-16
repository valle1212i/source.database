// routes/profile.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('./security');
const Customer = require('../models/Customer');

// liten hjälpare
const norm = (v) => (v ? String(v).trim().toLowerCase() : null);

// GET /api/profile/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    // 1) Hämta inloggad användare från req.user eller session
    const sessionUser = req.user || req.session?.user;
    if (!sessionUser?._id) {
      return res.status(401).json({ success: false, message: 'Inte inloggad' });
    }

    // 2) Hämta kundprofilen och SE TILL att tenant följer med
    //    (om ditt schema har select:false på tenant måste +tenant anges)
    const customer = await Customer.findById(sessionUser._id)
      .select('+tenant name email role plan settings language profileImage supportHistory') // +tenant är det viktiga
      .lean();

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Kund hittades inte' });
    }

    // 3) Bestäm tenant från DB / session / header
    const tenantFromDb       = norm(customer.tenant);
    const tenantFromSession  = norm(req.session?.tenant);
    const tenantFromHeader   = norm(req.get('X-Tenant'));
    const tenant             = tenantFromDb || tenantFromSession || tenantFromHeader || null;

    // 4) Spegla in i session så resten av API:t får den
    if (tenant && req.session) {
      req.session.tenant = tenant;
      // uppdatera även user-objektet i sessionen om det saknas
      if (req.session.user && !req.session.user.tenant) {
        req.session.user.tenant = tenant;
      }
    }

    // 5) Svara med profilinfo – OBS: inkluderar tenant
    return res.json({
      success: true,
      id: String(customer._id),
      name: customer.name || '',
      email: customer.email || '',
      role: customer.role || null,
      plan: customer.plan || null,
      tenant, // <-- viktigt för frontenden
      language: customer?.settings?.language || customer.language || null,
      profileImage: customer.profileImage || null,
      supportHistory: customer.supportHistory || []
    });
  } catch (err) {
    console.error('❌ Fel i /api/profile/me:', err);
    return res.status(500).json({ success: false, message: 'Serverfel' });
  }
});

module.exports = router;
