// routes/adsRoutes.js
const express = require('express');
const router = express.Router();
// Använd samma requireAuth som i servern:
const { requireAuth } = require('./security'); // eller ../middleware/requireAuth om den finns hos dig
const Ad = require('../models/Ad');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');

// Zod-schema: endast kända, platta fält
const adSchema = z.object({
  q1: z.string().max(500).trim().optional(),
  q2: z.string().max(500).trim().optional(),
  q3: z.string().max(500).trim().optional(),
  q4: z.string().max(500).trim().optional(),
  q5: z.string().max(500).trim().optional(),
  q6: z.string().max(500).trim().optional(),
  q7: z.string().max(500).trim().optional(),
  extraInfo: z.string().max(1000).trim().optional(),
}).strict();

const adsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'För många förfrågningar. Försök igen senare.' }
});

router.post('/:platform', requireAuth, adsLimiter, async (req, res) => {
  try {
    const platform = String(req.params.platform || '').toLowerCase();
    const allowedPlatforms = ['google', 'meta', 'linkedin', 'tiktok'];
    if (!allowedPlatforms.includes(platform)) {
      return res.status(400).json({ success: false, message: 'Ogiltig plattform' });
    }

    // Tillåt både nytt (platt) och gammalt (nästlat) format
    let body = req.body;
    if (body?.marketing?.googleAds) {
      const g = body.marketing.googleAds;
      body = {
        q1: g.type || '',
        q2: g.goals || '',
        q3: g.adType || '',
        q4: g.geography || '',
        q5: g.useImages || '',
        q6: g.brief || '',
        q7: g.offerOrDeadline || '',
        // extraInfo kan/brukar inte finnas här
      };
    }

    const parsed = adSchema.parse(body);

    // Sanera alla strängfält
    const cleanData = {};
    for (const [k, v] of Object.entries(parsed)) {
      cleanData[k] = typeof v === 'string'
        ? v.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
        : v;
    }

    const ad = new Ad({
      ...cleanData,
      platform,
      userId: req.session.user._id
    });

    await ad.save(); // ✅ Viktigt: spara
    return res.status(200).json({ success: true, id: ad._id });
  } catch (err) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ success: false, message: 'Ogiltiga fält', issues: err.errors });
    }
    console.error('ads error:', err);
    return res.status(500).json({ success: false, message: 'Serverfel vid inskick' });
  }
});

module.exports = router;
