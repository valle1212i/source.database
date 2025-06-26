// routes/invoiceRoutes.js
const express = require('express');
const router = express.Router();

// Middleware för att skydda routes
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ message: '❌ Inte inloggad' });
  }
  next();
}

// 🧾 Hämta användarens fakturor
router.get('/', requireLogin, async (req, res) => {
  try {
    const user = req.session.user;
    
    // Här skulle du normalt hämta fakturor från en databas
    // Temporärt: Testdata
    const fakturor = [
  {
    id: 1,
    datum: '2025-05-20',
    forfallodatum: '2025-06-20',
    betaldatum: null,
    belopp: 3200,
    status: 'Obetald'
  },
  {
    id: 2,
    datum: '2025-06-01',
    forfallodatum: '2025-07-01',
    betaldatum: '2025-06-28',
    belopp: 1890,
    status: 'Betald'
  },
  {
    id: 3,
    datum: '2025-06-10',
    forfallodatum: '2025-07-10',
    betaldatum: null,
    belopp: 1450,
    status: 'Obetald'
  }
];

    res.json({ fakturor });
  } catch (err) {
    console.error('❌ Fel vid hämtning av fakturor:', err);
    res.status(500).json({ message: 'Serverfel' });
  }
});

module.exports = router;
