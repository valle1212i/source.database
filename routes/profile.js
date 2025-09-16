// routes/profile.js
const express = require('express');
const router = express.Router();

// OBS: detta ska peka på din middleware som sätter req.user / req.session.user
// och säkerställer att användaren är inloggad.
const { requireAuth } = require('./security');

const Customer = require('../models/Customer');

// GET /api/profile/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    // Hämta användare från middleware/sessions
    const sessionUser = req.user || (req.session ? req.session.user : null);
    if (!sessionUser || !sessionUser._id) {
      return res.status(401).json({ success: false, message: 'Inte inloggad' });
    }

    // Hämta kundprofilen
    const customer = await Customer.findById(sessionUser._id).lean();
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Kund hittades inte' });
    }

    // Här plockar vi ut allt frontend behöver
    const language = (customer.settings && customer.settings.language) || customer.language || null;
    const profileImage = customer.profileImage || null;

    // VIKTIGT: tenant ska skickas med till frontend.
    // Ta i första hand från kundposten, annars från sessionen.
    const tenant = customer.tenant || sessionUser.tenant || null;

    return res.json({
      success: true,
      id: String(customer._id),
      name: customer.name || '',
      email: customer.email || '',
      role: customer.role || null,
      plan: customer.plan || null,
      tenant,                     // <-- nyckeln för kunder.html
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
