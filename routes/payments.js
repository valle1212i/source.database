const express = require('express');
const router = express.Router();
const Payment = require('../models/Payment');
const { Parser } = require('json2csv');

// Hämta lista (paginering + filtrering)
router.get('/', async (req, res) => {
  try {
    // Filtrera på inloggad kunds e-post som default,
    // men tillåt admin att se allt
    const user = req.session?.user;
    const isAdmin = user?.role === 'admin';

    const {
      email,            // valfritt: override filter
      status,           // tex "paid"
      start,            // ISO date
      end,              // ISO date
      q,                // fri text: sessionId eller payment_intent_id
      page = 1,
      limit = 20
    } = req.query;

    const query = {};

    if (!isAdmin) {
      // begränsa till eget konto
      if (user?.email) query.customer_email = user.email;
    } else if (email) {
      query.customer_email = email;
    }

    if (status) query.status = status;

    // datumintervall
    if (start || end) {
      query.stripe_created = {};
      if (start) query.stripe_created.$gte = new Date(start);
      if (end)   query.stripe_created.$lte = new Date(end);
    }

    if (q) {
      query.$or = [
        { sessionId: { $regex: q, $options: 'i' } },
        { payment_intent_id: { $regex: q, $options: 'i' } }
      ];
    }

    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const perPage  = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const [items, total] = await Promise.all([
      Payment.find(query)
        .sort({ stripe_created: -1 })
        .skip((pageNum - 1) * perPage)
        .limit(perPage)
        .lean(),
      Payment.countDocuments(query)
    ]);

    res.json({
      success: true,
      total,
      page: pageNum,
      limit: perPage,
      items
    });
  } catch (err) {
    console.error('GET /api/payments error:', err);
    res.status(500).json({ success: false, message: 'Serverfel vid hämtning av betalningar' });
  }
});

// Hämta en betalning (t.ex. för kvitto)
router.get('/:sessionId', async (req, res) => {
  try {
    const user = req.session?.user;
    const isAdmin = user?.role === 'admin';
    const sessionId = req.params.sessionId;

    const pay = await Payment.findOne({ sessionId }).lean();
    if (!pay) return res.status(404).json({ success: false, message: 'Hittades inte' });

    // Säkerhet: kunder får bara se egna betalningar
    if (!isAdmin && user?.email && pay.customer_email !== user.email) {
      return res.status(403).json({ success: false, message: 'Åtkomst nekad' });
    }

    res.json({ success: true, payment: pay });
  } catch (err) {
    console.error('GET /api/payments/:sessionId error:', err);
    res.status(500).json({ success: false, message: 'Serverfel' });
  }
});

// Exportera CSV (admin, eller begränsad till egen e-post)
router.get('/export/csv', async (req, res) => {
  try {
    const user = req.session?.user;
    const isAdmin = user?.role === 'admin';
    const { email, start, end, status } = req.query;

    const query = {};
    if (!isAdmin) {
      if (user?.email) query.customer_email = user.email;
    } else if (email) {
      query.customer_email = email;
    }
    if (status) query.status = status;
    if (start || end) {
      query.stripe_created = {};
      if (start) query.stripe_created.$gte = new Date(start);
      if (end)   query.stripe_created.$lte = new Date(end);
    }

    const docs = await Payment.find(query).sort({ stripe_created: -1 }).lean();
    const flat = docs.map(d => ({
      sessionId: d.sessionId,
      payment_intent_id: d.payment_intent_id,
      customer_email: d.customer_email,
      status: d.status,
      amount_total: d.amount_total,
      currency: d.currency,
      product: (d.line_items?.[0]?.product) || '',
      price_id: (d.line_items?.[0]?.price_id) || '',
      quantity: (d.line_items?.[0]?.quantity) || '',
      stripe_created: d.stripe_created ? new Date(d.stripe_created).toISOString() : '',
    }));

    const parser = new Parser();
    const csv = parser.parse(flat);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="payments.csv"');
    res.send('\ufeff' + csv); // BOM för Excel-kompatibilitet
  } catch (err) {
    console.error('GET /api/payments/export/csv error:', err);
    res.status(500).json({ success: false, message: 'Kunde inte exportera CSV' });
  }
});

module.exports = router;
