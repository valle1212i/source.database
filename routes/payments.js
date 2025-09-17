const express = require('express');
const router = express.Router();
const Payment = require('../models/Payment');
const { Parser } = require('json2csv');
const axios = require('axios');


// Hämta lista (paginering + filtrering)
router.get('/', async (req, res) => {
  try {
    const user = req.session?.user;
    const isAdmin = user?.role === 'admin';

    const {
      email,            // valfritt: override filter
      status,           // t.ex. "paid"
      start,            // ISO date
      end,              // ISO date
      q,                // fri text: sessionId eller payment_intent_id
      page = 1,
      limit = 20
    } = req.query;

    // Bygg query med AND/OR så vi kan kombinera fritt
    const and = [];

    // ----- Vems betalningar? -----
    if (isAdmin) {
      if (email) {
        const e = String(email).toLowerCase().trim();
        and.push({
          $or: [
            { customer_email: e },
            { 'merchant.email': e }
          ]
        });
      }
      // admin utan email → ser alla
    } else {
      const e = String(user?.email || '').toLowerCase().trim();
      if (e) {
        and.push({
          $or: [
            { customer_email: e },     // köp där jag är kund
            { 'merchant.email': e }    // köp där jag är säljare/partner
          ]
        });
      } else {
        // säkerhetsfallback: ingen e-post i sessionen → returnera tomt
        return res.json({ success: true, total: 0, page: 1, limit: Number(limit) || 20, items: [] });
      }
    }

    // ----- Status -----
    if (status) and.push({ status });

    // ----- Datumintervall på stripe_created (UNIX sek → vi sparar som Date i modellen) -----
    if (start || end) {
      const range = {};
      if (start) range.$gte = new Date(start);
      if (end)   range.$lte = new Date(end);
      and.push({ stripe_created: range });
    }

    // ----- Sök på id -----
    if (q) {
      const rx = new RegExp(String(q).trim(), 'i');
      and.push({
        $or: [
          { sessionId: rx },
          { payment_intent_id: rx },
          { charge_id: rx }
        ]
      });
    }

    const query = and.length ? { $and: and } : {};

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

    // Säkerhet: kunder får bara se egna betalningar (som kund eller som merchant)
    if (!isAdmin) {
      const e = String(user?.email || '').toLowerCase();
      const isMine = (pay.customer_email?.toLowerCase() === e) || (pay.merchant?.email?.toLowerCase() === e);
      if (!isMine) return res.status(403).json({ success: false, message: 'Åtkomst nekad' });
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

    const and = [];

    if (isAdmin) {
      if (email) {
        const e = String(email).toLowerCase().trim();
        and.push({ $or: [{ customer_email: e }, { 'merchant.email': e }] });
      }
    } else {
      const e = String(user?.email || '').toLowerCase().trim();
      and.push({ $or: [{ customer_email: e }, { 'merchant.email': e }] });
    }

    if (status) and.push({ status });
    if (start || end) {
      const range = {};
      if (start) range.$gte = new Date(start);
      if (end)   range.$lte = new Date(end);
      and.push({ stripe_created: range });
    }

    const query = and.length ? { $and: and } : {};
    const docs = await Payment.find(query).sort({ stripe_created: -1 }).lean();

    const flat = docs.map(d => ({
      sessionId: d.sessionId,
      payment_intent_id: d.payment_intent_id,
      customer_email: d.customer_email,
      merchant_email: d.merchant?.email || '',
      status: d.status,
      amount_total: d.amount_total,
      currency: d.currency,
      product: (d.line_items?.[0]?.product_name) || '',
      price_id: (d.line_items?.[0]?.price_id) || '',
      quantity: (d.line_items?.[0]?.quantity) || '',
      stripe_created: d.stripe_created
        ? new Date(d.stripe_created).toISOString()
        : ''
    }));

    const parser = new Parser();
    const csv = parser.parse(flat);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="payments.csv"');
    res.send('\ufeff' + csv); // BOM för Excel
  } catch (err) {
    console.error('GET /api/payments/export/csv error:', err);
    res.status(500).json({ success: false, message: 'Kunde inte exportera CSV' });
  }
});
// --- Skapa återbetalning (admin eller merchant) ---
router.post('/refund', async (req, res) => {
    try {
      // 0) Auth
      const user = req.session?.user;
      if (!user?._id) return res.status(401).json({ success: false, message: 'Inte inloggad' });
  
      const { sessionId, amount, reason } = req.body || {};
      if (!sessionId) {
        return res.status(400).json({ success: false, message: 'sessionId krävs' });
      }
  
      // 1) Behörighet – endast admin eller merchant får återbetala
      const pay = await Payment.findOne({ sessionId }).lean();
      if (!pay) return res.status(404).json({ success: false, message: 'Betalningen hittades inte' });
  
      const isAdmin    = user?.role === 'admin';
      const isMerchant = (pay.merchant?.email || '').toLowerCase() === (user.email || '').toLowerCase();
      if (!isAdmin && !isMerchant) {
        return res.status(403).json({ success: false, message: 'Åtkomst nekad' });
      }
  
      // 2) Miljövariabler för proxy → Payments-servern
      const base   = process.env.PAYMENTS_BASE;           // t.ex. https://aurora-backend-kund-oversvamningsskydd.onrender.com
      const secret = process.env.PAYMENTS_SHARED_SECRET;  // samma som i payments/server.js
  
      if (!base || !/^https?:\/\//i.test(base)) {
        return res.status(500).json({ success: false, message: 'PAYMENTS_BASE saknas eller är ogiltig' });
      }
      if (!secret) {
        return res.status(500).json({ success: false, message: 'PAYMENTS_SHARED_SECRET saknas' });
      }
  
      // 3) Bygg kropp och headers – amount anges i öre vid delåterbetalning
      const payload = {
        sessionId: String(sessionId),
        // amount & reason är valfria, inkludera bara om de skickats
        ...(Number.isInteger(amount) && amount > 0 ? { amount } : {}),
        ...(reason ? { reason: String(reason) } : {}),
        actor: {
          id: String(user._id || ''),
          email: String(user.email || ''),
          name: String(user.name || ''),
          role: String(user.role || '')
        }
      };
  
      const resp = await axios.post(
        `${base.replace(/\/+$/, '')}/api/payments/refund`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Payments-Secret': secret
          },
          timeout: 15000
        }
      );
  
      // 4) Forwarda svaret från Payments-servern
      return res.status(resp.status).json(resp.data);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Återbetalningen misslyckades';
      const code = err?.response?.status || 500;
      console.error('POST /api/payments/refund error:', msg);
      return res.status(code).json({ success: false, message: msg });
    }
  });
  

module.exports = router;
