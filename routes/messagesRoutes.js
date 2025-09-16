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
    const { name, email, message, subject, company /* consent */ } = req.body || {};

    // Honeypot (company ifyllt => ignorera tyst)
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

    // ✅ Upsert av Customer per (email, tenant) – idempotent och tålig för E11000
    const displayName = name || (email ? email.split('@')[0] : 'Kund');
    let customer;
    try {
      const query = { email, tenant };
      const update = { $setOnInsert: { email, tenant, role: 'customer' } };
      if (displayName) update.$set = { name: displayName };

      customer = await Customer.findOneAndUpdate(query, update, {
        new: true,
        upsert: true,
        runValidators: true,
      });
    } catch (e) {
      if (e && e.code === 11000) {
        // Parallell request hann skapa den – hämta igen
        customer = await Customer.findOne({ email, tenant });
      } else {
        throw e;
      }
    }
    if (!customer) throw new Error('Kunde inte slå upp/skapa kund');

    // Säkra defaults
    const subjectSafe = (subject && String(subject).trim()) || 'Kontaktformulär';

    // Bygg meddelande – lägg alltid med tenant (ignoreras av Mongoose om fältet saknas)
    const docPayload = {
      customerId: customer._id,
      tenant,                             // <— alltid med
      subject: subjectSafe,               // <— alltid med
      message: clip(message, 5000),
      sender: 'customer',
      timestamp: new Date(),
    };

    const doc = await Message.create(docPayload);
    return res.status(201).json({ success: true, id: String(doc._id) });
  } catch (err) {
    // Svara 400 på valideringsfel istället för 500
    if (err?.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Valideringsfel',
        errors: Object.fromEntries(
          Object.entries(err.errors || {}).map(([k, v]) => [k, v?.message || 'ogiltigt'])
        ),
      });
    }

    // Dubblett-e-post hanteras redan men låt det vara kvar
    const code = err && (err.code || err.name || 'ERR');
    if (String(code) === '11000') {
      return res.status(409).json({
        success: false,
        message: 'E-postadressen är redan registrerad.',
        code: 'DUPLICATE_EMAIL',
      });
    }

    console.error('❌ /api/messages POST error:', err?.message || err, err?.stack);
    return res.status(500).json({
      success: false,
      message: 'Serverfel',
      ...(process.env.NODE_ENV !== 'production'
        ? { error: err.message || String(err), code }
        : {}),
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
