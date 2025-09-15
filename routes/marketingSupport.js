// routes/marketingSupport.js
const express = require('express');
const router = express.Router();
const Customers = require('../models/Customer');
const requireAuth = require('../middleware/requireAuth'); // eller din security.requireAuth

router.post('/', requireAuth, async (req, res) => {
  try {
    const userEmail = req.user?.email || req.session?.user?.email || req.body?.userEmail || null;
    if (!userEmail) return res.status(401).json({ success:false, message:'Inte inloggad.' });

    const customer = await Customers.findOne({ email: userEmail }).lean();
    if (!customer) return res.status(404).json({ success:false, message:'Kund hittades inte.' });

    // Acceptera flera former från frontend
    const incoming =
      req.body.marketing?.support ||
      req.body.support ||
      (req.body.ticket ? { status:'open', tickets:[req.body.ticket], notes:req.body.notes || null } : null);

    if (!incoming) return res.status(400).json({ success:false, message:'Ingen support-data i body.' });

    const current = customer.marketing?.support || {};
    const merged = {
      status: incoming.status || current.status || 'open',
      meetings: Array.isArray(current.meetings) ? current.meetings : [],
      tickets: [
        ...(Array.isArray(current.tickets) ? current.tickets : []),
        ...(Array.isArray(incoming.tickets) ? incoming.tickets : []),
      ],
      notes: incoming.notes ?? current.notes ?? null,
      updatedAt: new Date().toISOString(),
    };

    await Customers.updateOne(
      { _id: customer._id },
      { $set: { 'marketing.support': merged, updatedAt: new Date().toISOString() } }
    );

    res.json({ success:true });
  } catch (err) {
    console.error('support save error:', err);
    res.status(500).json({ success:false, message:'Serverfel vid sparning av support.' });
  }
});

module.exports = router;
