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
// routes/messageRoutes.js (ERSÄTT ENDAST POST-ROUTEN)
router.post('/', contactLimiter, async (req, res) => {
  try {
    const { name, email, message, subject, company } = req.body || {};

    // Honeypot: om ifyllt -> låtsas OK men gör inget
    if (company && String(company).trim() !== '') {
      return res.status(200).json({ success: true, ignored: true });
    }
    if (!email || !message) {
      return res.status(400).json({ success: false, message: 'E-post och meddelande krävs' });
    }

    // Tenant måste med (från X-Tenant / body.tenant / query.tenant / subdomän)
    const tenant = resolveTenant(req);
    if (!tenant) {
      return res.status(400).json({ success: false, message: 'Tenant saknas' });
    }

    const displayName = name || (email ? email.split('@')[0] : 'Kund');

    // 1) Försök hitta kunden
    let customer = await Customer.findOne({ email, tenant }).exec();

    // 2) Om inte finns: skapa en *ren lead-kund* (role: 'customer' ⇒ inga krav på password/groupId)
    if (!customer) {
      try {
        const lead = new Customer({
          email,
          tenant,
          role: 'customer',        // *** VIKTIGT: tvinga rätt role ***
          name: displayName || undefined,
          // LÄMNA INTE med password/groupId alls för leads
        });

        // Validera tydligt – om något i schemat blockerar får vi ett bra fel
        await lead.validate();

        // Spara
        customer = await lead.save();
        if (!customer) {
          // extremt ovanligt, men var explicita
          throw new Error('Lead.save() gav inget dokument');
        }
      } catch (e) {
        // Hjälpsam respons + logg vid valideringsfel el. annat
        console.error('❌ Customer lead-create error:', e?.message || e, e?.stack);
        if (e?.name === 'ValidationError') {
          const errors = Object.fromEntries(
            Object.entries(e.errors || {}).map(([k, v]) => [k, v?.message || 'ogiltigt'])
          );
          return res.status(400).json({
            success: false,
            message: 'Valideringsfel vid kundskapande',
            errors,
            ...(req.query?.debug === '1' ? { raw: e.message } : {}),
          });
        }
        if (String(e?.code) === '11000') {
          // Race condition: någon annan hann skapa den – hämta igen
          customer = await Customer.findOne({ email, tenant }).exec();
          if (!customer) {
            return res.status(500).json({
              success: false,
              message: 'Kunde inte återfinna kund efter E11000',
            });
          }
        } else {
          return res.status(500).json({
            success: false,
            message: 'Serverfel vid kundskapande',
            ...(req.query?.debug === '1' ? { error: e?.message || String(e) } : {}),
          });
        }
      }
    }

    // Extra säkerhetskoll
    if (!customer || !customer._id) {
      return res.status(500).json({
        success: false,
        message: 'Kunde inte slå upp/skapa kund (saknar _id)',
        ...(req.query?.debug === '1' ? { customer } : {}),
      });
    }

    // 3) Skapa meddelande (validera först för bra 400-svar)
    const docPayload = {
      customerId: customer._id,
      tenant, // ok även om Message-schemat saknar fältet – Mongoose ignorerar
      subject: (subject && String(subject).trim()) || 'Kontaktformulär',
      message: typeof message === 'string' ? message.slice(0, 5000) : '',
      sender: 'customer',
      timestamp: new Date(),
    };

    const toValidate = new Message(docPayload);
    await toValidate.validate();

    const doc = await Message.create(docPayload);
    return res.status(201).json({ success: true, id: String(doc._id) });

  } catch (err) {
    // Fångruta för andra fel (t.ex. DB-nedtid)
    console.error('❌ /api/messages POST error:', err?.message || err, err?.stack);
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
    return res.status(500).json({
      success: false,
      message: 'Serverfel',
      ...(req.query?.debug === '1' ? { error: err?.message || String(err) } : {}),
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
