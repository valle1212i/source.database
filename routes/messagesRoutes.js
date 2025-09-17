// routes/messageRoutes.js
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const InboxMessage = require('../models/InboxMessage');
const Customer = require('../models/Customer');
const requireAuth = require('../middleware/requireAuth');
const requireTenant = require('../middleware/requireTenant'); // OK även om den lämnar req.tenant null

// Rate limit mot spam i publik POST
const contactLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

// --- Hjälpare ---
function resolveTenant(req) {
  let t =
    (req.body?.tenant || '').trim() ||
    (req.get('X-Tenant') || '').trim() ||
    (req.query?.tenant || '').trim();

  if (!t) {
    const host = (req.headers.host || '').toLowerCase().split(':')[0];
    const m = host.match(/^([a-z0-9-]+)\./i);
    if (m && m[1] && m[1] !== 'www') t = m[1];
  }
  return t || null;
}

const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');

// ------------------------------------------------------------------
// POST /api/messages   (Publik kontakt/inkorg)
// ------------------------------------------------------------------
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

    // Tenant krävs för att lagra korrekt
    const tenant = resolveTenant(req);
    if (!tenant) {
      return res.status(400).json({ success: false, message: 'Tenant saknas' });
    }
    const tenantNorm = String(tenant).trim().toLowerCase();
    const displayName = name || (email ? email.split('@')[0] : 'Kund');

    // Hitta eller skapa lead/kund inom den tenanten
    let customer = await Customer.findOne({ email, tenant: tenantNorm }).exec();
    if (!customer) {
      try {
        const lead = new Customer({
          email,
          tenant: tenantNorm,
          role: 'customer',
          name: displayName || undefined,
        });
        await lead.validate();
        customer = await lead.save();
      } catch (e) {
        if (String(e?.code) === '11000') {
          // Dublettmail: försök läsa igen
          customer =
            (await Customer.findOne({ email, tenant: tenantNorm }).exec()) ||
            (await Customer.findOne({ email }).exec());
          // Om legacy-kund saknar tenant, försök migrera den
          if (customer && !customer.tenant) {
            try {
              await Customer.updateOne(
                { _id: customer._id, $or: [{ tenant: { $exists: false } }, { tenant: null }, { tenant: '' }] },
                { $set: { tenant: tenantNorm } },
                { runValidators: false }
              );
              customer = (await Customer.findOne({ email, tenant: tenantNorm }).exec()) || customer;
            } catch (e2) {
              if (String(e2?.code) === '11000') {
                const again = await Customer.findOne({ email, tenant: tenantNorm }).exec();
                if (again) customer = again;
                else {
                  return res.status(409).json({
                    success: false,
                    message: 'Konflikt vid tenant-migrering.',
                    code: 'TENANT_MERGE_CONFLICT',
                  });
                }
              } else {
                return res.status(500).json({
                  success: false,
                  message: 'Serverfel vid migrering av legacy-kund',
                });
              }
            }
          }
        } else if (e?.name === 'ValidationError') {
          const errors = Object.fromEntries(
            Object.entries(e.errors || {}).map(([k, v]) => [k, v?.message || 'ogiltigt'])
          );
          return res.status(400).json({
            success: false,
            message: 'Valideringsfel vid kundskapande',
            errors,
          });
        } else {
          return res.status(500).json({
            success: false,
            message: 'Serverfel vid kundskapande',
          });
        }
      }
    }

    if (!customer || !customer._id) {
      return res.status(500).json({ success: false, message: 'Kunde inte slå upp/skapa kund (saknar _id)' });
    }

    // Spara inboxmeddelandet
    const payload = {
      customerId: customer._id,
      tenant: tenantNorm,
      subject: (subject && String(subject).trim()) || 'Kontaktformulär',
      message: clip(message, 5000),
      sender: 'customer',
      timestamp: new Date(),
    };

    const toValidate = new InboxMessage(payload);
    await toValidate.validate();

    const doc = await InboxMessage.create(payload);
    return res.status(201).json({ success: true, id: String(doc._id) });
  } catch (err) {
    console.error('❌ /api/messages POST error:', err?.message || err);
    if (err?.name === 'ValidationError') {
      const errors = Object.fromEntries(
        Object.entries(err.errors || {}).map(([k, v]) => [k, v?.message || 'ogiltigt'])
      );
      return res.status(400).json({ success: false, message: 'Valideringsfel', errors });
    }
    if (String(err?.code) === '11000') {
      return res.status(409).json({ success: false, message: 'E-postadressen är redan registrerad.', code: 'DUPLICATE_EMAIL' });
    }
    return res.status(500).json({ success: false, message: 'Serverfel' });
  }
});

// ------------------------------------------------------------------
// GET /api/messages/latest   (Senaste meddelandet per kund, tenant-aware)
// ------------------------------------------------------------------
router.get('/latest', requireAuth, requireTenant, async (req, res) => {
  try {
    const pipeline = [
      { $sort: { timestamp: -1 } },
      {
        $lookup: {
          from: 'customers',
          localField: 'customerId',
          foreignField: '_id',
          as: 'cust',
        },
      },
      { $unwind: '$cust' },
      // Fallback: matcha bara på tenant om den faktiskt finns
      ...(req.tenant ? [{ $match: { 'cust.tenant': req.tenant } }] : []),
    ];

    const messages = await InboxMessage.aggregate(pipeline);
    res.json(messages);
  } catch (err) {
    console.error('❌ /api/messages/latest error:', err);
    res.status(500).json({ error: 'Serverfel' });
  }
});

// ------------------------------------------------------------------
// GET /api/messages?page=&limit=&q=   (pagination + sök + senaste per kund)
// ------------------------------------------------------------------
router.get('/', requireAuth, requireTenant, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const q = (req.query.q || '').trim();

    const matchSearch = q
      ? [
          {
            $match: {
              $or: [
                { message: { $regex: q, $options: 'i' } },
                { subject: { $regex: q, $options: 'i' } },
              ],
            },
          },
        ]
      : [];

    const base = [
      { $sort: { timestamp: -1 } },
      {
        $lookup: {
          from: 'customers',
          localField: 'customerId',
          foreignField: '_id',
          as: 'cust',
        },
      },
      { $unwind: '$cust' },
      // Fallback: filtrera bara på tenant om vi faktiskt har en
      ...(req.tenant ? [{ $match: { 'cust.tenant': req.tenant } }] : []),
      ...matchSearch,
      {
        // Senaste per kund
        $group: {
          _id: '$customerId',
          message: { $first: '$message' },
          subject: { $first: '$subject' },
          sender: { $first: '$sender' },
          timestamp: { $first: '$timestamp' },
          customer: { $first: '$cust' },
        },
      },
      { $sort: { timestamp: -1 } },
    ];

    const dataPipeline = [
      ...base,
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          customerId: '$_id',
          customerName: { $ifNull: ['$customer.name', 'Okänd'] },
          subject: { $ifNull: ['$subject', '(Ej angivet)'] },
          message: 1,
          date: '$timestamp',
          email: '$customer.email',
        },
      },
    ];

    const countPipeline = [...base, { $count: 'total' }];

    const [items, totalArr] = await Promise.all([
      InboxMessage.aggregate(dataPipeline),
      InboxMessage.aggregate(countPipeline),
    ]);

    const total = totalArr[0]?.total ?? items.length;
    const totalPages = Math.max(Math.ceil(total / limit), 1);

    res.json({ page, limit, total, totalPages, items });
  } catch (err) {
    console.error('❌ /api/messages GET error:', err);
    res.status(400).json({ error: 'Bad Request', detail: err.message });
  }
});

module.exports = router;
