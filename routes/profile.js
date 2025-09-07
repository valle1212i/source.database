const express = require('express');
const router = express.Router();
const { requireAuth } = require('./security'); // byt från verifyToken till requireAuth
const Customer = require('../models/Customer');

// GET /api/profile/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const customer = await Customer.findById(req.session.user._id); // använd session-data
    if (!customer) {
      return res.status(404).json({ success: false, message: "Kund hittades inte" });
    }

const language = (customer.settings && customer.settings.language) || customer.language;
const profileImage = customer.profileImage;

res.json({
  success: true,
  _id: customer._id,
  name: customer.name,
  email: customer.email,
  language,
  profileImage,
  supportHistory: customer.supportHistory || []
});
  } catch (err) {
    console.error("❌ Fel i /profile/me:", err);
    res.status(500).json({ success: false, message: "Serverfel" });
  }
});

module.exports = router;
