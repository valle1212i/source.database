// routes/profile.js
const express = require('express');
const router = express.Router();

const { requireAuth } = require('./security');
const Customer = require('../models/Customer');

router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId =
      (req.user && req.user._id) ||
      (req.session && req.session.user && req.session.user._id);

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Inte inloggad' });
    }

    const customer = await Customer.findById(userId).lean();
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Kund hittades inte' });
    }

    const tenantFromDb      = customer.tenant ? String(customer.tenant).trim().toLowerCase() : null;
    const tenantFromSession = req.session?.tenant ? String(req.session.tenant).trim().toLowerCase() : null;
    const tenantFromHeader  = req.get('X-Tenant') ? String(req.get('X-Tenant')).trim().toLowerCase() : null;

    const tenant = tenantFromDb || tenantFromSession || tenantFromHeader || null;

    // Spegla till sessionen så resten av API:t kan läsa den
    if (tenant && req.session) {
      req.session.tenant = tenant;
    }

    return res.json({
      success: true,
      id: String(customer._id),
      name: customer.name || '',
      email: customer.email || '',
      role: customer.role || null,
      plan: customer.plan || null,
      tenant, // <- VIKTIGT: skickas nu tillbaka
      language: (customer.settings?.language || customer.language || null),
      profileImage: customer.profileImage || null,
      supportHistory: customer.supportHistory || []
    });
  } catch (err) {
    console.error('❌ Fel i /api/profile/me:', err);
    return res.status(500).json({ success: false, message: 'Serverfel' });
  }
});

module.exports = router;
