const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');

// 🔐 GET /api/customers/me – Hämta nuvarande inloggade kund
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

// 💾 PUT /api/customers/:id/marketing – Spara marknadsföringsval
router.put('/:id/marketing', async (req, res) => {
  const { id } = req.params;
  const marketingData = req.body;

  try {
    const updatedCustomer = await Customer.findByIdAndUpdate(
      id,
      { marketing: marketingData },
      { new: true, runValidators: true }
    );

    if (!updatedCustomer) {
      return res.status(404).json({ success: false, message: "Kund hittades inte." });
    }

    res.json({ success: true, message: "Marknadsföringsval sparade.", data: updatedCustomer });
  } catch (err) {
    console.error("❌ Fel vid uppdatering av marknadsföring:", err);
    res.status(500).json({ success: false, message: "Serverfel vid uppdatering." });
  }
});

module.exports = router;
