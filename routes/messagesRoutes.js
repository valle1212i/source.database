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

    // Honeypot: om “company” ifyllt, svara OK men gör inget
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

    // --- Hitta eller skapa kund (utan upsert-trassel) ---
    const displayName = name || (email ? email.split('@')[0] : 'Kund');
    let customer = await Customer.findOne({ email, tenant });

    if (!customer) {
      try {
        customer = await Customer.create({
          email,
          tenant,
          role: 'customer',              // => password & groupId ej required
          name: displayName || undefined
        });
      } catch (e) {
        // Dublett? (någon annan hann skapa den precis)
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
      // Uppdatera namn om nytt displayName inkommit
      if (displayName && displayName !== customer.name) {
        try {
          await Customer.updateOne(
            { _id: customer._id },
            { $set: { name: displayName } }
          );
          customer.name = displayName;
        } catch (e) {
          console.warn('⚠️ Kunde inte uppdatera kundnamn:', e?.message || e);
        }
      }
    }

    // Om vi fortfarande saknar kund: avbryt kontrollerat
    if (!customer) {
      return res.status(500).json({
        success: false,
        message: 'Kunde inte slå upp/skapa kund'
      });
    }

    // Bygg meddelandedokument — sätt endast fält som finns i schemat
    const docPayload = {
      customerId: customer._id,
      message: clip(message, 5000),
      sender: 'customer',
      timestamp: new Date(),
    };

    if (Object.prototype.hasOwnProperty.call(Message.schema.paths, 'subject')) {
      docPayload.subject = (subject && String(subject).trim()) || 'Kontaktformulär';
    }
    if (Object.prototype.hasOwnProperty.call(Message.schema.paths, 'tenant')) {
      docPayload.tenant = tenant;
    }

    // ✅ Förvalidera så vi kan svara 400 med detaljer i stället för 500
    const toValidate = new Message(docPayload);
    await toValidate.validate();

    const doc = await Message.create(docPayload);
    return res.status(201).json({ success: true, id: String(doc._id) });

  } catch (err) {
    if (err?.name === 'ValidationError') {
      const errors = Object.fromEntries(
        Object.entries(err.errors || {}).map(([k, v]) => [k, v?.message || 'ogiltigt'])
      );
      return res.status(400).json({
        success: false,
        message: 'Valideringsfel',
        errors,
        ...(req.query?.debug === '1' ? { raw: err.message } : {}),
      });
    }

    if (String(err?.code) === '11000') {
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
