// routes/customers.js

const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');

router.get('/me', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Ej inloggad' });
  }

  try {
    const customer = await Customer.findById(req.session.user._id);
    if (!customer) return res.status(404).json({ error: 'Kund hittades inte' });
    res.json({ _id: customer._id, namn: customer.namn, email: customer.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Serverfel' });
  }
});

module.exports = router;