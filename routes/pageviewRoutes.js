const express = require("express");
const router = express.Router();
const Pageview = require("../models/PageView");
const Customer = require("../models/Customer");
const { URL } = require("url");
const requireAuth = require('../middleware/requireAuth');


router.post("/track", async (req, res) => {
  try {
    const { url, page, referrer, visitorId } = req.body;

    if (!url || !visitorId) {
      return res.status(400).json({ success: false, message: "Saknar nödvändig data" });
    }

    const hostname = new URL(url).hostname.replace(/^www\./, "");

    const customer = await Customer.findOne({
      website: { $regex: hostname, $options: "i" }
    });

    if (!customer) {
      console.warn("🔍 Ingen kund matchade värddelen:", hostname);
      return res.status(404).json({ success: false, message: "Kund hittades inte" });
    }

    await Pageview.create({
      customerId: customer._id,
      url,
      page,
      referrer,
      visitorId,
      timestamp: new Date(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Fel vid spårning:", err);
    res.status(500).json({ success: false, message: "Serverfel vid spårning" });
  }
});

module.exports = router;
