const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');

const Message = require('../models/Message');
const Customer = require('../models/Customer');
const requireAuth = require('../middleware/requireAuth');
const requireTenant = require('../middleware/requireTenant');

// 🔒 Rate limit mot spam/botar
const contactLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/messages
 * Publik endpoint (kontaktformulär)
 */
router.post('/', contactLimiter, async (req, res) => {
  try {
    const { name, email, message, subject, company, consent } = req.body || {};

    // Honeypot
    if (company && String(company).trim() !== '') {
      return res.status(200).json({ success: true });
    }

    if (!email || !message) {
      return res.status(400).json({ success: false, message: 'E-post och meddelande krävs' });
    }

    // --- Tenant-resolution ---
    let resolvedTenant = (req.body?.tenant || req.get('X-Tenant') || req.query?.tenant || '').trim();
    if (!resolvedTenant) {
      const host = (req.headers.host || '').toLowerCase();
      const m = host.match(/^([a-z0-9-]+)\./i);
      if (m && m[1]) resolvedTenant = m[1];
    }
    if (!resolvedTenant) {
      return res.status(400).json({ success: false, message: 'Tenant saknas' });
    }

    // --- Customer lookup/create ---
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

    // --- Message payload ---
    const docPayload = {
      customerId: customer._id,
      message: String(message).slice(0, 5000),
      sender: 'customer',
      timestamp: new Date()
    };

    if ('subject' in Message.schema.paths) {
      docPayload.subject = subject || null;
    }
    if ('tenant' in Message.schema.paths) {
      docPayload.tenant = resolvedTenant;
    }

    const doc = await Message.create(docPayload);
    return res.json({ success: true, id: doc._id });
  } catch (err) {
    console.error('❌ /api/messages POST error:', err);
    return res.status(500).json({ success: false, message: 'Serverfel' });
  }
});

/**
 * GET /api/messages/latest
 */
router.get('/latest', requireAuth, requireTenant, async (req, res) => {
  try {
    const user = req.user || req.session?.user;

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
      ...((user.role !== 'admin' || req.tenant) ? [{ $match: { 'cust.tenant': req.tenant || { $exists: true } } }] : []),
      {
        $group: {
          _id: "$customerId",
          message: { $first: "$message" },
          timestamp: { $first: "$timestamp" },
          sender: { $first: "$sender" },
          customer: { $first: "$cust" }
        }
      }
    ];

    const messages = await Message.aggregate(pipeline);
    const enriched = messages.map(msg => ({
      customerName: msg.customer?.name || "Okänd",
      subject: msg.subject || "(Ej implementerat)",
      message: msg.message,
      date: msg.timestamp
    }));

    res.json(enriched);
  } catch (err) {
    console.error('❌ Fel vid hämtning:', err);
    res.status(500).json({ error: 'Serverfel' });
  }
});

module.exports = router;
