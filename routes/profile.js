// routes/profile.js
const express = require('express');
const router = express.Router();

const { requireAuth } = require('./security'); // din auth-middleware
const Customer = require('../models/Customer');

// GET /api/profile/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    // 1) Inloggad användare från req.user eller session
    const sessionUser = req.user || req.session?.user;
    if (!sessionUser || !sessionUser._id) {
      return res.status(401).json({ success: false, message: 'Inte inloggad' });
    }

    // 2) Hämta kunden (välj uttryckligen fält vi vill skicka till klienten)
    const customer = await Customer.findById(sessionUser._id)
      .select('name email role plan tenant settings profileImage supportHistory')
      .lean();

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Kund hittades inte' });
    }

    // 3) Härleder tenant i prioriterad ordning (DB -> session -> header)
    const tenantFromDb       = customer.tenant ? String(customer.tenant).trim().toLowerCase() : null;
    const tenantFromSession  = req.session?.tenant ? String(req.session.tenant).trim().toLowerCase() : null;
    const tenantFromHeader   = req.get('X-Tenant') ? String(req.get('X-Tenant')).trim().toLowerCase() : null;
    const tenant             = tenantFromDb || tenantFromSession || tenantFromHeader || null;

    // 4) Spara tillbaka i session (så requireTenant/server-mw kan nyttja det)
    if (req.session) {
      req.session.tenant = tenant;
      // Uppdatera även en slimmad user i sessionen
      req.session.user = {
        _id: String(customer._id),
        email: customer.email,
        role: customer.role,
        tenant, // viktigt för senare middleware
      };
    }

    // 5) Normaliserat språk (finns i settings.language hos din modell)
    const language = customer?.settings?.language || null;

    // 6) Svar till klienten
    return res.json({
      success: true,
      id: String(customer._id),
      name: customer.name || '',
      email: customer.email || '',
      role: customer.role || null,
      plan: customer.plan || null,
      tenant,                         // <- VIKTIGT för frontenden
      language,                       // settings.language
      profileImage: customer.profileImage || null,
      supportHistory: customer.supportHistory || []
    });
  } catch (err) {
    console.error('❌ Fel i /api/profile/me:', err);
    return res.status(500).json({ success: false, message: 'Serverfel' });
  }
});

module.exports = router;
