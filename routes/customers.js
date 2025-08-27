const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const requireAuth = require('../middleware/requireAuth');

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

// 💾 PUT /api/customers/marketing/:platform – Spara formulärsvar för inloggad kund
router.put('/marketing/:platform', requireAuth, async (req, res) => {
  if (!req.session.user || !req.session.user.email) {
    return res.status(401).json({ error: "Inte inloggad" });
  }

  const { platform } = req.params; // "google", "meta", etc.
  const { answers } = req.body;

  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: "Ogiltiga data" });
  }

  try {
    const updated = await Customer.findOneAndUpdate(
      { email: req.session.user.email },
      {
        $set: {
          [`marketing.${platform}`]: answers,
          'marketing.updatedAt': new Date()
        }
      },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: "Kund hittades inte" });
    }

    res.json({ success: true, data: updated.marketing[platform] });
  } catch (err) {
    console.error("❌ Fel vid sparande av formulärsvar:", err);
    res.status(500).json({ error: "Serverfel vid sparande" });
  }
});

// 💾 PUT /api/customers/:id/marketing – Spara all marknadsföringsdata (endast admin)
router.put('/:id/marketing', requireAuth, async (req, res) => {
  if (req.session.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Åtkomst nekad' });
  }
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
