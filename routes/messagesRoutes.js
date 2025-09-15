// routes/messageRoutes.js
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const Message = require('../models/Message');
const Customer = require('../models/Customer');
const requireAuth = require('../middleware/requireAuth');
const requireTenant = require('../middleware/requireTenant');

// ─────────────────────────────────────────────────────────────────────────────
// Rate limit (kontaktformulär / publik POST)
// ─────────────────────────────────────────────────────────────────────────────
const contactLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

// Liten hjälpare för basic e-postkoll (håll simpelt)
const isEmail = (str = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(str).trim());

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/messages  (publik – används av kontaktformulär på kundens sajt)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', contactLimiter, async (req, res) => {
  try {
    const {
      name = '',
      email = '',
      message = '',
      subject = '',
      company = '',     // honeypot
      consent,
      // valfria meta från formuläret – sparas bara om schema stödjer det
      path,
      ref,
      ua,
      source,
      tenant: tenantFromBody
    } = req.body || {};

    // 1) Honeypot: om fältet finns och inte är tomt → låtsas OK
    if (typeof company === 'string' && company.trim() !== '') {
      return res.status(200).json({ success: true });
    }

    // 2) Grundvalidering
    if (!isEmail(email) || !message.trim()) {
      return res.status(400).json({ success: false, message: 'E-post och meddelande krävs' });
    }

    // 3) Bestäm tenant (body → header → query → subdomän)
    let resolvedTenant =
      (tenantFromBody && String(tenantFromBody).trim()) ||
      (req.get('X-Tenant') && String(req.get('X-Tenant')).trim()) ||
      (req.query?.tenant && String(req.query.tenant).trim()) ||
      '';

    if (!resolvedTenant) {
      const host = (req.headers.host || '').toLowerCase();
      // plocka ut subdomän, ex: vattentrygg.source-database.onrender.com
      const m = host.match(/^([a-z0-9-]+)\./i);
      if (m && m[1]) resolvedTenant = m[1];
    }

    if (!resolvedTenant) {
      return res.status(400).json({ success: false, message: 'Tenant saknas' });
    }

    // 4) Slå upp / skapa customer på (email + tenant)
    let customer = await Customer.findOne({ email, tenant: resolvedTenant });
    if (!customer) {
      customer = await Customer.create({
        name: name || email.split('@')[0],
        email,
        tenant: resolvedTenant,
        role: 'customer'
      });
    } else if (name && !customer.name) {
      customer.name = name;
      await customer.save();
    }

    // 5) Skapa meddelande
    const docPayload = {
      customerId: customer._id,
      message: String(message).slice(0, 5000),
      sender: 'customer',
      timestamp: new Date()
    };

    // tilldela subject om fältet finns i schemat
    if (Object.prototype.hasOwnProperty.call(Message.schema.paths, 'subject')) {
      docPayload.subject = subject || null;
    }

    // tilldela tenant om fältet finns i schemat
    if (Object.prototype.hasOwnProperty.call(Message.schema.paths, 'tenant')) {
      docPayload.tenant = resolvedTenant;
    }

    // valfria meta – bara om de finns i schema
    if (Object.prototype.hasOwnProperty.call(Message.schema.paths, 'path') && path) {
      docPayload.path = String(path);
    }
    if (Object.prototype.hasOwnProperty.call(Message.schema.paths, 'ref') && ref) {
      docPayload.ref = String(ref);
    }
    if (Object.prototype.hasOwnProperty.call(Message.schema.paths, 'ua') && ua) {
      docPayload.ua = String(ua);
    }
    if (Object.prototype.hasOwnProperty.call(Message.schema.paths, 'source') && source) {
      docPayload.source = String(source);
    }
    if (Object.prototype.hasOwnProperty.call(Message.schema.paths, 'consent')) {
      docPayload.consent = Boolean(consent);
    }

    const doc = await Message.create(docPayload);
    return res.status(201).json({ success: true, id: doc._id });
  } catch (err) {
    console.error('❌ /api/messages POST error:', err);
    return res.status(500).json({ success: false, message: 'Serverfel' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/messages/latest  (skyddad – används i kundportalen)
// - Admin utan ?tenant → alla tenants
// - Admin med ?tenant eller X-Tenant → filtreras
// - Icke-admin → låst till sin egen tenant (via requireTenant)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/latest', requireAuth, requireTenant, async (req, res) => {
  try {
    const user = req.user || req.session?.user;

    const matchTenantStage =
      (user.role !== 'admin' || req.tenant)
        ? [{ $match: { 'cust.tenant': req.tenant || { $exists: true } } }]
        : [];

    const pipeline = [
      { $sort: { timestamp: -1 } },
      {
        $lookup: {
          from: 'customers',          // Mongo collection-namn
          localField: 'customerId',
          foreignField: '_id',
          as: 'cust'
        }
      },
      { $unwind: '$cust' },
      ...matchTenantStage,
      {
        $group: {
          _id: '$customerId',
          message:   { $first: '$message' },
          timestamp: { $first: '$timestamp' },
          sender:    { $first: '$sender' },
          subject:   { $first: '$subject' }, // ✅ se till att subject följer med
          customer:  { $first: '$cust' }
        }
      }
    ];

    const rows = await Message.aggregate(pipeline);

    const enriched = rows.map((row) => {
      const customerName = row.customer?.name || 'Okänd';
      // datumfallback om ni i framtiden byter fält
      const date = row.timestamp || row.createdAt || row.updatedAt || null;
      return {
        customerName,
        subject: row.subject || '(Ej implementerat)',
        message: row.message,
        date
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error('❌ Fel vid hämtning /latest:', err);
    res.status(500).json({ error: 'Serverfel' });
  }
});

module.exports = router;
