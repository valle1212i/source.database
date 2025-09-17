// routes/supportInbound.js
const express = require('express');
const router = express.Router();

// Enkel Bearer-auth för server-till-server
function requireInboundAuth(req, res, next) {
  const auth = req.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1];
  if (!token || token !== process.env.PORTAL_INBOUND_TOKEN) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

// (Valfritt) liten sanitiser
function clean(str, max = 2000) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim().slice(0, max);
}

// POST /api/support/ticket  ← det som Aurora/`curl` ska träffa
router.post('/ticket', requireInboundAuth, express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const email = clean(req.body?.email, 320);
    const name = clean(req.body?.name || '', 200);
    const message = clean(req.body?.message, 4000);

    if (!email || !message) {
      return res.status(400).json({ success: false, message: 'email och message krävs' });
    }

    // Spara ärendet (om du har en modell – annars logga tills vidare)
    // Exempel (om du har en Ticket-modell):
    // const Ticket = require('../models/Ticket');
    // const doc = await Ticket.create({ email, name, message, source: 'aurora', createdAt: new Date() });

    // Tills du har modell: skriv enkel logg och svara OK
    console.log('✅ Inkommande support-ärende:', { email, name, message });

    return res.status(201).json({
      success: true,
      ticket: { email, name, message }
    });
  } catch (err) {
    console.error('❌ Inbound ticket error:', err);
    return res.status(500).json({ success: false, message: 'Serverfel' });
  }
});

module.exports = router;
