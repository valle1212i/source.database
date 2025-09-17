const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const requireAuth = require('../middleware/requireAuth');
const { z } = require('zod');

// Fallback om requireRole saknas (t.ex. efter merge-konflikt)
const ensureAdmin = (req, res, next) => {
  if (req.session?.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Åtkomst nekad' });
  }
  next();
};


const allowedPlatforms = ['google', 'meta', 'linkedin', 'tiktok'];

const platformAnswersSchema = z.object({
  q1: z.string().max(500).trim().optional(),
  q2: z.string().max(500).trim().optional(),
  q3: z.string().max(500).trim().optional(),
  q4: z.string().max(500).trim().optional(),
  q5: z.string().max(500).trim().optional(),
  q6: z.string().max(500).trim().optional(),
  q7: z.string().max(500).trim().optional(),
}).strict();

const marketingSchema = z.object({
  platforms: z.array(z.enum(allowedPlatforms)).max(10).optional(),
  goals: z.string().max(500).trim().optional(),
  comment: z.string().max(1000).trim().optional(),
  otherNotes: z.string().max(1000).trim().optional(),

  google: platformAnswersSchema.optional(),
  meta: platformAnswersSchema.optional(),
  tiktok: platformAnswersSchema.optional(),
  linkedin: platformAnswersSchema.optional(),

  // Bakåtkompabilitet – tillåt men begränsa
  googleAds: z.object({
    selected: z.boolean().optional(),
    budget: z.string().max(200).trim().optional(),
    goals: z.string().max(500).trim().optional(),
  }).partial().optional(),
  metaAds: z.object({
    selected: z.boolean().optional(),
    budget: z.string().max(200).trim().optional(),
    goals: z.string().max(500).trim().optional(),
  }).partial().optional(),
  tiktokAds: z.object({
    selected: z.boolean().optional(),
    budget: z.string().max(200).trim().optional(),
    goals: z.string().max(500).trim().optional(),
  }).partial().optional(),
  linkedinAds: z.object({
    selected: z.boolean().optional(),
    budget: z.string().max(200).trim().optional(),
    goals: z.string().max(500).trim().optional(),
  }).partial().optional(),
}).strict();

function sanitizeString(s) {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
function sanitizeObjectShallow(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (typeof v === 'string') out[k] = sanitizeString(v);
    else out[k] = v;
  }
  return out;
}

// 🔐 GET /api/customers/me – samma response-shape som tidigare, men utan lösenord
router.get('/me', async (req, res) => {
  if (!req.session?.user?.email) {
    return res.status(401).json({ error: "Inte inloggad" });
  }
  try {
    const customer = await Customer
      .findOne({ email: req.session.user.email })
      .select('-password') // dölj känsligt fält, i övrigt samma form
      .lean();

    if (!customer) return res.status(404).json({ error: "Kund hittades inte" });

    return res.json(customer);
  } catch (err) {
    console.error("❌ Fel vid hämtning av kund:", err);
    return res.status(500).json({ error: "Serverfel" });
  }
});

// 💾 PUT /api/customers/marketing/:platform – validerad & sanerad
router.put('/marketing/:platform', requireAuth, async (req, res) => {
  if (!req.session?.user?.email) {
    return res.status(401).json({ success: false, message: "Inte inloggad" });
  }

  const { platform } = req.params;
  if (!allowedPlatforms.includes(platform)) {
    return res.status(400).json({ success: false, message: "Ogiltig plattform" });
  }

  try {
    const parsed = platformAnswersSchema.parse(req.body?.answers || {});
    const clean = sanitizeObjectShallow(parsed);

    const updated = await Customer.findOneAndUpdate(
      { email: req.session.user.email },
      {
        $set: {
          [`marketing.${platform}`]: clean,
          'marketing.updatedAt': new Date()
        }
      },
      { new: true, projection: { marketing: 1 } }
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: "Kund hittades inte" });
    }

    return res.json({ success: true, data: updated.marketing?.[platform] || {} });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ success: false, message: "Ogiltiga data", issues: err.errors });
    }
    console.error("❌ Fel vid sparande av formulärsvar:", err);
    return res.status(500).json({ success: false, message: "Serverfel vid sparande" });
  }
});

// 💾 PUT /api/customers/:id/marketing – admin, validerad & sanerad
router.put('/:id/marketing', requireAuth, (requireAuth.requireRole ? requireAuth.requireRole('admin') : ensureAdmin), async (req, res) => {
  const { id } = req.params;
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    return res.status(400).json({ success: false, message: 'Ogiltigt id-format' });
  }

  try {
    const parsed = marketingSchema.parse(req.body || {});
    const clean = sanitizeObjectShallow(parsed);

    const updatedCustomer = await Customer.findByIdAndUpdate(
      id,
      { marketing: clean },
      { new: true, runValidators: true }
    );

    if (!updatedCustomer) {
      return res.status(404).json({ success: false, message: "Kund hittades inte." });
    }

    // message + full kund under data
    return res.json({
      success: true,
      message: "Marknadsföringsval sparade.",
      data: updatedCustomer
    });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ success: false, message: "Ogiltiga data", issues: err.errors });
    }
    console.error("❌ Fel vid uppdatering av marknadsföring:", err);
    return res.status(500).json({ success: false, message: "Serverfel vid uppdatering." });
  }
});

module.exports = router;
