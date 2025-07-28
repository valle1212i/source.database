const express = require("express");
const router = express.Router();
const Customer = require("../models/Customer");
const PageView = require("../models/PageView");

router.post("/track", async (req, res) => {
  const url = req.body.url;

  if (!url) {
    return res.status(400).json({ success: false, message: "Ingen URL angiven" });
  }

  try {
    // Hämta kunden med matchande website
    const customer = await Customer.findOne({ website: url });

    if (!customer) {
      return res.status(404).json({ success: false, message: "Kund hittades inte" });
    }

    // Spara sidvisningen
    await PageView.create({
      customerId: customer._id,
      url
    });

    res.json({ success: true, message: "Sidvisning registrerad" });

  } catch (err) {
    console.error("❌ Fel vid spårning:", err);
    res.status(500).json({ success: false, message: "Serverfel" });
  }
});

router.get("/all", async (req, res) => {
  const data = await PageView.find().sort({ timestamp: -1 }).limit(10);
  res.json(data);
});

module.exports = router;
