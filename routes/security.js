const express = require("express");
const router = express.Router();
const LoginEvent = require("../models/LoginEvent");
const Customer = require("../models/Customer");

// Middleware: Säkerställ att användare är inloggad
function requireAuth(req, res, next) {
  if (req.session?.user?._id) {
    return next();
  }
  return res.status(401).json({ success: false, message: "Inte inloggad" });
}

// GET: Senaste inloggningar för inloggad användare
router.get("/logins", requireAuth, async (req, res) => {
  try {
    const logins = await LoginEvent.find({ userId: req.session.user._id })
      .sort({ timestamp: -1 })
      .limit(10);

    res.json({
      success: true,
      logins: logins.map(entry => ({
        timestamp: new Date(entry.timestamp).toLocaleString("sv-SE"),
        ip: entry.ip,
        device: entry.device
      }))
    });
  } catch (err) {
    console.error("Fel vid hämtning av inloggningar:", err);
    res.status(500).json({ success: false, message: "Kunde inte hämta historik" });
  }
});

  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Endast admin kan se login-historik.' });
  }

// GET: Alla inloggningar (endast för admin)
const requireAuth = require('../middleware/requireAuth');

router.get('/all-logins', requireAuth, async (req, res) => {
  const isAdmin = req.session.user?.role === "admin";

  if (!isAdmin) {
    return res.status(403).json({ success: false, message: "Åtkomst nekad" });
  }

  try {
    const events = await LoginEvent.find({})
      .sort({ timestamp: -1 })
      .limit(50)
      .populate("userId", "name email");

    const formatted = events.map(entry => ({
      timestamp: new Date(entry.timestamp).toLocaleString("sv-SE"),
      ip: entry.ip,
      device: entry.device,
      name: entry.userId?.name || "Okänd",
      email: entry.userId?.email || "okänd@domän.se"
    }));

    res.json({ success: true, logins: formatted });
  } catch (err) {
    console.error("Fel vid hämtning av all loggdata:", err);
    res.status(500).json({ success: false, message: "Misslyckades att hämta loggar" });
  }
});

// ✅ Endast EN export:
module.exports = {
  router,
  requireAuth
};
