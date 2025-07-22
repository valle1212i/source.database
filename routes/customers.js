const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');

// GET /api/customers/me – hämta nuvarande inloggade kund
router.get('/me', async (req, res) => {
  if (!req.session.user || !req.session.user.email) {
    return res.status(401).json({ error: "Inte inloggad" });
  }

  try {
    const customer = await Customer.findOne({ email: req.session.user.email });
    if (!customer) return res.status(404).json({ error: "Kund hittades inte" });

    res.json(customer);
  } catch (err) {
    console.error("❌ Fel vid hämtning av kund:", err);
    res.status(500).json({ error: "Serverfel" });
  }
});

module.exports = router;
