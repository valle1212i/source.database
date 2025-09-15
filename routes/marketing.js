// routes/marketing.js
const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');

const nowISO = () => new Date().toISOString();
const getEmail = (req) =>
  req.user?.email || req.session?.user?.email || req.body?.userEmail || null;

const PLATFORM_MAP = {
  google:   'googleAds',
  meta:     'metaAds',
  tiktok:   'tiktokAds',
  linkedin: 'linkedinAds',
};

// ✅ Ändra HÄR: ta bort inline-regex i pathen
router.post('/customers/marketing/:platform', async (req, res) => {
  try {
    const platformParam = String(req.params.platform || '').toLowerCase();

    // ✅ Validera i kod i stället för i path-strängen
    if (!Object.prototype.hasOwnProperty.call(PLATFORM_MAP, platformParam)) {
      return res.status(400).json({
        error: 'Ogiltig platform. Tillåtna: google, meta, tiktok, linkedin'
      });
    }

    const key = PLATFORM_MAP[platformParam];

    const userEmail = getEmail(req);
    if (!userEmail) return res.status(400).json({ error: 'userEmail saknas (ingen session?)' });

    let incoming = req.body?.marketing?.[key];

    // Stöd för "answers"-formatet
    if (!incoming && req.body?.answers) {
      const a = req.body.answers;
      incoming = {
        goals: a.q2 || '',
        type: a.q1 || '',
        adType: a.q3 || '',
        geography: a.q4 || '',
        useImages: a.q5 || '',
        brief: a.q6 || '',
        offerOrDeadline: a.q7 || '',
      };
    }

    if (!incoming) return res.status(400).json({ error: `Ingen data för ${key} i payload` });

    const customer = await Customer.findOne({ email: userEmail }).lean();
    if (!customer) return res.status(404).json({ error: 'Kund hittades inte' });

    const marketing = customer.marketing || {};
    const prev = marketing[key] || {};

    const mergedMarketing = {
      ...marketing,
      [key]: { ...prev, ...incoming },
      updatedAt: nowISO(),
    };

    await Customer.updateOne(
      { _id: customer._id },
      { $set: { marketing: mergedMarketing } }
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('marketing save error:', e);
    res.status(500).json({ error: 'Kunde inte spara marketing-data' });
  }
});

module.exports = router;
