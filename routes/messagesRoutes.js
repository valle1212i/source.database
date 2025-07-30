const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Customer = require('../models/Customer');
const authenticate = require('../middleware/authenticate');




// Hämta senaste meddelandet per kund
router.get('/latest', async (req, res) => {
  try {
    const messages = await Message.aggregate([
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: "$customerId",
          message: { $first: "$message" },
          timestamp: { $first: "$timestamp" },
          sender: { $first: "$sender" }
        }
      }
    ]);

    const enriched = await Promise.all(messages.map(async (msg) => {
      const customer = await Customer.findById(msg._id);
      return {
        customerName: customer?.name || "Okänd",
        subject: "(Ej implementerat)",
        message: msg.message,
        date: msg.timestamp
      };
    }));

    res.json(enriched);
  } catch (err) {
    console.error('❌ Fel vid hämtning:', err);
    res.status(500).json({ error: 'Serverfel' });
  }
});

module.exports = router;
