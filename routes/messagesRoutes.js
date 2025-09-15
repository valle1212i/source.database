// routes/messageRoutes.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const Message = require('../models/Message');
const Customer = require('../models/Customer');
const requireAuth = require('../middleware/requireAuth');
const requireTenant = require('../middleware/requireTenant');

// Rate limit för publik POST (kontaktformulär)
const createLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

// Hjälpare: bestäm tenant från header/query/body eller req.user
function resolveTenant(req) {
  const h = (req.headers['x-tenant'] || '').trim();
  const q = (req.query.tenant || req.body?.tenant || '').trim();
  if (h) return h;
  if (q) return q;
  return req.user?.tenant || null;
}

/**
 * POST /api/messages
 * Publik endpoint (ingen auth). Sparar inkommande kontaktmeddelanden.
 * – Honeypot: "company" => spam → 200 OK men ingen lagring
 * – tenant krävs (via X-Tenant / ?tenant / body.tenant)
 */
router.post('/', createLimiter, async (req, res) => {
  try {
    const { name, email, message, subject, consent, company, path, ref, ua } = req.body || {};

    // Honeypot
    if (company && company.trim() !== '') {
      return res.status(200).json({ success: true, spam: true });
    }

    // Validering
    if (!name || !email || !message) {
      return res.status(400).json({ success: false, message: 'name, email, message krävs' });
    }

    const tenant = resolveTenant(req);
    if (!tenant) {
      return res.status(400).json({ success: false, message: 'tenant saknas' });
    }

    // Hitta / skapa kund inom den tenant
    let customer = await Customer.findOne({ email, tenant });
    if (!customer) {
      customer = await Customer.create({
        name, email, tenant, role: 'customer'
      });
    }

    // Spara meddelandet (lägg gärna fältet tenant i Message-schemat)
    const doc = await Message.create({
      tenant,                       // <- starkt rekommenderat fält i Message
      customerId: customer._id,
      name, email,
      subject: subject || 'Kontaktformulär',
      message,
      sender: 'customer',
      consent: !!consent,
      path: path || req.body?.path || null,
      ref: ref || req.get('referer') || null,
      ua: ua || req.get('user-agent') || null,
      timestamp: new Date()
    });

    return res.status(201).json({ success: true, id: doc._id });
  } catch (err) {
    console.error('❌ POST /api/messages:', err);
    return res.status(500).json({ success: false, message: 'Serverfel' });
  }
});

/**
 * GET /api/messages/latest
 * Senaste meddelandet per kund (tenant-aware).
 * – Admin: kan se alla tenants, eller filtrera med ?tenant / X-Tenant.
 * – Icke-admin: begränsad till sin tenant (sätts av requireTenant).
 */
router.get('/latest', requireAuth, requireTenant, async (req, res) => {
  try {
    const user = req.user || req.session?.user;

    // Välj pipeline beroende på om Message har tenant-fält
    const hasTenantField = true; // sätt till false om ditt Message-schema saknar tenant

    let pipeline;

    if (hasTenantField) {
      // VARIANT A: Message har tenant ⇒ snabbare
      const match = {};
      if (user.role !== 'admin' || req.tenant) {
        match.tenant = req.tenant || { $exists: true };
      }

      pipeline = [
        Object.keys(match).length ? { $match: match } : null,
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: "$customerId",
            message: { $first: "$message" },
            subject: { $first: "$subject" },
            timestamp: { $first: "$timestamp" },
            sender: { $first: "$sender" }
          }
        },
        {
          $lookup: {
            from: 'customers',
            localField: '_id',
            foreignField: '_id',
            as: 'cust'
          }
        },
        { $unwind: { path: '$cust', preserveNullAndEmptyArrays: true } }
      ].filter(Boolean);
    } else {
      // VARIANT B: Message saknar tenant ⇒ join:a Customer och filtrera där
      pipeline = [
        { $sort: { timestamp: -1 } },
        { $lookup: { from: 'customers', localField: 'customerId', foreignField: '_id', as: 'cust' } },
        { $unwind: '$cust' },
        ...( (user.role !== 'admin' || req.tenant) ? [{ $match: { 'cust.tenant': req.tenant || { $exists: true } } }] : [] ),
        {
          $group: {
            _id: "$customerId",
            message: { $first: "$message" },
            subject: { $first: "$subject" },
            timestamp: { $first: "$timestamp" },
            sender: { $first: "$sender" },
            customer: { $first: "$cust" }
          }
        }
      ];
    }

    const rows = await Message.aggregate(pipeline);

    const enriched = rows.map(r => {
      const customer = hasTenantField ? r.cust : r.customer;
      return {
        customerName: customer?.name || 'Okänd',
        subject: r.subject || '(saknas)',
        message: r.message,
        date: r.timestamp
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error('❌ GET /api/messages/latest:', err);
    res.status(500).json({ error: 'Serverfel' });
  }
});

module.exports = router;
