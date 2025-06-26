// routes/analyticsRoutes.js
const express = require('express');
const router = express.Router();

// 🔐 Middleware: Kräver inloggning
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ message: '❌ Inte inloggad' });
  }
  next();
}

// 📊 Hämta rapportdata
router.get('/', requireLogin, async (req, res) => {
  try {
    const user = req.session.user;

    // Simulerad rapportdata (exempelvis försäljning per månad)
    const rapporter = [
      { månad: 'Januari', försäljning: 15000 },
      { månad: 'Februari', försäljning: 13200 },
      { månad: 'Mars', försäljning: 17600 },
      { månad: 'April', försäljning: 19800 }
    ];

    res.json({ rapporter });
  } catch (err) {
    console.error('❌ Fel vid hämtning av rapporter:', err);
    res.status(500).json({ message: 'Serverfel' });
  }
});

module.exports = router;
