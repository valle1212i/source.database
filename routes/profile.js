const express = require('express');
const router = express.Router();
const { verifyToken } = require('./security'); // eller din auth-middleware
const Customer = require('../models/Customer'); // justera om din modell heter något annat

// GET /api/profile/me
router.get('/me', verifyToken, async (req, res) => {
  try {
    const customer = await Customer.findById(req.user.id); // eller req.user._id
    if (!customer) {
      return res.status(404).json({ success: false, message: "Kund hittades inte" });
    }

    res.json({
      success: true,
      _id: customer._id,
      name: customer.name,
      email: customer.email,
      supportHistory: customer.supportHistory || [] // om du har det lagrat i kundmodellen
    });
  } catch (err) {
    console.error("❌ Fel i /profile/me:", err);
    res.status(500).json({ success: false, message: "Serverfel" });
  }
});

module.exports = router;
