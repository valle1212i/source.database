const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const Ad = require('../models/Ad');
const rateLimit = require('express-rate-limit');

const { z } = require('zod');

// Schema för annonser (tillåt endast kända fält, rimliga längder)
const adSchema = z.object({
  q1: z.string().max(500).trim().optional(),
  q2: z.string().max(500).trim().optional(),
  q3: z.string().max(500).trim().optional(),
  q4: z.string().max(500).trim().optional(),
  q5: z.string().max(500).trim().optional(),
  q6: z.string().max(500).trim().optional(),
  q7: z.string().max(500).trim().optional(),
  extraInfo: z.string().max(1000).trim().optional()
}).strict();

// Per-IP rate limit för annonsinskick (10/min)
const adsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'För många förfrågningar. Försök igen senare.' }
});

// Generisk POST-handler
router.post('/:platform', requireAuth, adsLimiter, async (req, res) => {
  const platform = req.params.platform;

  const allowedPlatforms = ['google', 'meta', 'linkedin', 'tiktok'];
  if (!allowedPlatforms.includes(platform)) {
    return res.status(400).json({ success: false, message: 'Ogiltig plattform' });
  }

  try {
    const parsed = adSchema.parse(req.body);

    // sanera alla strängfält
    const cleanData = {};
    for (const [k, v] of Object.entries(parsed)) {
      cleanData[k] = typeof v === "string"
        ? v.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
        : v;
    }

    const ad = new Ad({
      ...cleanData,
      platform,
      userId: req.session.user._id
    });
    await ad.save();                 // 👈 lägg till detta
    return res.status(200).json({ success: true });

        // Behåll legacy-beteende: samma statuskod och svar
    res.status(200).json({ success: true });
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json({ success: false, message: 'Ogiltiga fält', issues: err.errors });
    }
    console.error(`${platform} Ads error:`, err);
    res.status(500).json({ success: false, message: 'Serverfel vid inskick' });
  }
});

module.exports = router;
