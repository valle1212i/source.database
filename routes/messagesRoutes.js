const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Customer = require('../models/Customer');
const requireAuth = require('../middleware/requireAuth');
const requireTenant = require('../middleware/requireTenant');

/**
 * GET /api/messages/latest
 * - Returnerar senaste meddelandet per kund (tenant-aware).
 * - Admin: kan se alla tenants (om ingen ?tenant skickas).
 * - Icke-admin: låst till sin egen tenant (eller ?tenant måste matcha user.tenant).
 */
router.get('/latest', requireAuth, requireTenant, async (req, res) => {
  try {
    const user = req.user || req.session?.user;

    // ------------------------------
    // V A R I A N T  A  (rekommenderad om Message har fältet "tenant")
    // ------------------------------
    // const matchStage = {};
    // if (user.role !== 'admin' || req.tenant) {
    //   // Icke-admin måste alltid filtrera på req.tenant (satt av middleware)
    //   // Admin kan ange ?tenant för att filtrera, annars får de "alla".
    //   matchStage.tenant = req.tenant || { $exists: true };
    // }

    // const pipeline = [
    //   Object.keys(matchStage).length ? { $match: matchStage } : null,
    //   { $sort: { timestamp: -1 } },
    //   {
    //     $group: {
    //       _id: "$customerId",
    //       message: { $first: "$message" },
    //       timestamp: { $first: "$timestamp" },
    //       sender: { $first: "$sender" }
    //     }
    //   }
    // ].filter(Boolean);

    // const messages = await Message.aggregate(pipeline);

    // ------------------------------
    // V A R I A N T  B  (använd om Message INTE har "tenant", men Customer har det)
    // ------------------------------
    const pipeline = [
      { $sort: { timestamp: -1 } },
      // Knyt ihop med Customer för att nå tenant
      {
        $lookup: {
          from: 'customers',               // OBS: collection-namn i Mongo (plural/lowercase)
          localField: 'customerId',
          foreignField: '_id',
          as: 'cust'
        }
      },
      { $unwind: '$cust' },
      // Filtrera på tenant om nödvändigt
      ...( (user.role !== 'admin' || req.tenant) ? [{ $match: { 'cust.tenant': req.tenant || { $exists: true } } }] : [] ),
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

    // Bygg svaret
    const enriched = messages.map((msg) => {
      const customerName = (msg.customer?.name) || "Okänd";
      return {
        customerName,
        subject: "(Ej implementerat)",
        message: msg.message,
        date: msg.timestamp
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error('❌ Fel vid hämtning:', err);
    res.status(500).json({ error: 'Serverfel' });
  }
});

module.exports = router;
