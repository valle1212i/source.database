const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const Ad = require('../models/Ad');

// Generisk POST-handler
router.post('/:platform', requireAuth, async (req, res) => {
  const platform = req.params.platform;

  const allowedPlatforms = ['google', 'meta', 'linkedin', 'tiktok'];
  if (!allowedPlatforms.includes(platform)) {
    return res.status(400).json({ success: false, message: 'Ogiltig plattform' });
  }

  try {
    const ad = new Ad({
      ...req.body,
      platform,
      userId: req.session.user._id
    });

    await ad.save();
    res.status(200).json({ success: true });
  } catch (err) {
    console.error(`${platform} Ads error:`, err);
    res.status(500).json({ success: false, message: 'Fel vid inskick' });
  }
});

module.exports = router;
