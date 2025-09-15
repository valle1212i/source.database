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
    // subdomän.exempel.se -> subdomän
    const m = host.match(/^([a-z0-9-]+)\./i);
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
    const { name, email, message, subject, company, consent } = req.body || {};

    // Honeypot (company ifyllt => ignorera tyst)
    if (company && String(company).trim() !== '') {
      return res.status(200).json({ success: true });
    }

    if (!email || !message) {
      return res.status(400).json({ success: false, message: 'E-post och meddelande krävs' });
    }

    const tenant = resolveTenant(req);
    if (!tenant) {
      return res.status(400).json({ success: false, message: 'Tenant saknas' });
    }

    // ✅ Upsert av Customer per (email, tenant) – idempotent
    const displayName = name || email.split('@')[0];
    const customer = await Customer.findOneAndUpdate(
      { email, tenant },
      {
        $setOnInsert: {
          name: displayName,
          email,
          tenant,
          role: 'customer'
        },
        // Om kund redan finns men saknar namn => fyll på
        ...(name ? { $set: { name: displayName } } : {})
      },
      { new: true, upsert: true }
    );

    // Bygg meddelandedokument
    const docPayload = {
      customerId: customer._id,
      message: clip(message, 5000),
      sender: 'customer',
      timestamp: new Date()
    };

    // Sätt endast fält som faktiskt finns i Message-schemat
    if (Object.prototype.hasOwnProperty.call(Message.schema.paths, 'subject')) {
      docPayload.subject = subject || null;
    }
    if (Object.prototype.hasOwnProperty.call(Message.schema.paths, 'tenant')) {
      docPayload.tenant = tenant;
    }

    const doc = await Message.create(docPayload);
    return res.status(201).json({ success: true, id: String(doc._id) });

  } catch (err) {
    // Vanliga fel: E11000 (unik email utan tenant i schema), valideringsfel etc.
    const code = err && (err.code || err.name || 'ERR');
    const msg = err && (err.message || 'Serverfel');
    console.error('❌ /api/messages POST error:', code, msg);

    if (String(code) === '11000') {
      return res.status(409).json({
        success: false,
        message: 'E-postadressen är redan registrerad.',
        code: 'DUPLICATE_EMAIL'
      });
    }

    return res.status(500).json({ success: false, message: 'Serverfel' });
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
          from: 'customers',
          localField: 'customerId',
          foreignField: '_id',
          as: 'cust'
        }
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
          customer: { $first: '$cust' }
        }
      }
    ];

    const messages = await Message.aggregate(pipeline);

    const enriched = messages.map((m) => ({
      customerName: m.customer?.name || 'Okänd',
      subject: m.subject || '(Ej implementerat)',
      message: m.message,
      date: m.timestamp
    }));

    res.json(enriched);
  } catch (err) {
    console.error('❌ /api/messages/latest error:', err);
    res.status(500).json({ error: 'Serverfel' });
  }
});

module.exports = router;
