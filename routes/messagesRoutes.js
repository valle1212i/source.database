// routes/messageRoutes.js
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const Message = require('../models/Message');
const Customer = require('../models/Customer');
const requireAuth = require('../middleware/requireAuth');
const requireTenant = require('../middleware/requireTenant');

// 🔒 Rate limit mot spam/botar
const contactLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 min
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

// Hjälp: säkert kapa textlängd
const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');

// 🔎 Resolve tenant från header/query/body/subdomän
function resolveTenant(req) {
  let t =
    (req.body?.tenant || '').trim() ||
    (req.get('X-Tenant') || '').trim() ||
    (req.query?.tenant || '').trim();

  if (!t) {
    const host = (req.headers.host || '').toLowerCase();
    const m = host.match(/^([a-z0-9-]+)\./i); // subdomän.exempel.se -> subdomän
    if (m && m[1] && m[1] !== 'www') t = m[1];
  }
  return t || null;
}

/**
 * POST /api/messages
 * Publik endpoint (kontaktformulär från kundens webb)
 */
router.post('/', contactLimiter, async (req, res) => {
  try {
    const { name, email, message, subject, company } = req.body || {};

    // Honeypot
    if (company && String(company).trim() !== '') {
      return res.status(200).json({ success: true, ignored: true });
    }
    if (!email || !message) {
      return res.status(400).json({ success: false, message: 'E-post och meddelande krävs' });
    }

    const tenant = resolveTenant(req);
    if (!tenant) {
      return res.status(400).json({ success: false, message: 'Tenant saknas' });
    }

    // Upsert kund (idempotent)
   // --- Hitta eller skapa kund (utan upsert-trassel) ---
const displayName = name || (email ? email.split('@')[0] : 'Kund');
let customer = await Customer.findOne({ email, tenant });

if (!customer) {
  try {
    customer = await Customer.create({
      email,
      tenant,
      role: 'customer',              // viktigt: undvik krav på password/groupId
      name: displayName || undefined
    });
  } catch (e) {
    // Dublett? (någon annan hann skapa den)
    if (e && e.code === 11000) {
      customer = await Customer.findOne({ email, tenant });
    } else {
      console.error('❌ Customer.create error:', e?.message || e, e?.stack);
      return res.status(500).json({
        success: false,
        message: 'Serverfel vid kundskapande',
        ...(req.query?.debug === '1' ? { error: e?.message || String(e) } : {})
      });
    }
  }
} else {
  // uppdatera namn om vi fick ett nytt displayName
  if (displayName && displayName !== customer.name) {
    try {
      await Customer.updateOne(
        { _id: customer._id },
        { $set: { name: displayName } }
      );
    } catch (e) {
      console.warn('⚠️ Kunde inte uppdatera kundnamn:', e?.message || e);
    }
  }
}


    const docPayload = {
      customerId: customer._id,
      tenant,                                         // ok även om fältet ej finns – Mongoose ignorerar
      subject: (subject && String(subject).trim()) || 'Kontaktformulär',
      message: typeof message === 'string' ? message.slice(0, 5000) : '',
      sender: 'customer',
      timestamp: new Date(),
    };

    // ✅ Förvalidera så vi kan svara 400 med detaljer
    const toValidate = new Message(docPayload);
    await toValidate.validate();

    // Skapa först när validering gick igenom
    const doc = await Message.create(docPayload);
    return res.status(201).json({ success: true, id: String(doc._id) });

  } catch (err) {
    // Svara tydligt på valideringsfel
    if (err?.name === 'ValidationError') {
      const errors = Object.fromEntries(
        Object.entries(err.errors || {}).map(([k, v]) => [k, v?.message || 'ogiltigt'])
      );
      // visa extra info om du lägger ?debug=1 i URL:en (även i prod)
      const debug = (req.query && req.query.debug === '1');
      return res.status(400).json({
        success: false,
        message: 'Valideringsfel',
        errors,
        ...(debug ? { raw: err.message } : {}),
      });
    }

    if (String(err?.code) === '11000') {
      return res.status(409).json({
        success: false,
        message: 'E-postadressen är redan registrerad.',
        code: 'DUPLICATE_EMAIL',
      });
    }

    // Mer hjälpsam server-logg
    console.error('❌ /api/messages POST error:', err?.message || err, err?.stack);
    return res.status(500).json({
      success: false,
      message: 'Serverfel',
      // lägg ?debug=1 på URL:en om du vill få med feltext även i prod
      ...(req.query?.debug === '1' ? { error: err.message || String(err) } : {}),
    });
  }
});


/**
 * GET /api/messages/latest
 * - Senaste meddelandet per kund, tenant-aware
 */
router.get('/latest', requireAuth, requireTenant, async (req, res) => {
  try {
    const user = req.user || req.session?.user;

    // Variant B: om Message saknar "tenant" men Customer har det
    const pipeline = [
      { $sort: { timestamp: -1 } },
      {
        $lookup: {
          from: 'customers', // Mongo-samlingens namn
          localField: 'customerId',
          foreignField: '_id',
          as: 'cust',
        },
      },
      { $unwind: '$cust' },
      ...((user.role !== 'admin' || req.tenant)
        ? [{ $match: { 'cust.tenant': req.tenant || { $exists: true } } }]
        : []),
      {
        $group: {
          _id: '$customerId',
          message: { $first: '$message' },
          timestamp: { $first: '$timestamp' },
          sender: { $first: '$sender' },
          subject: { $first: '$subject' },
          customer: { $first: '$cust' },
        },
      },
    ];

    const messages = await Message.aggregate(pipeline);

    const enriched = messages.map((m) => ({
      customerName: m.customer?.name || 'Okänd',
      subject: m.subject || '(Ej implementerat)',
      message: m.message,
      date: m.timestamp,
    }));

    res.json(enriched);
  } catch (err) {
    console.error('❌ /api/messages/latest error:', err);
    res.status(500).json({ error: 'Serverfel' });
  }
});

module.exports = router;
