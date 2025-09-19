const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const PageviewEvent = require('../models/PageviewEvent');
const Customer = require('../models/Customer'); // behövs för att läsa kundens domän

// Försök ladda offline-geo (ingen extern trafik)
let geoip;
try { geoip = require('geoip-lite'); } catch { geoip = null; }

// Enkel UA-botfilter (kan utökas vid behov)
const BOT_UA = /(bot|spider|crawl|crawler|preview|fetch|monitor|uptime|pingdom|node\.js|axios|cf-|headless|scrapy|seo)/i;

// Strikt origin-whitelist enligt spec (kompletterar global CORS)
const ORIGIN_WHITELIST = new Set([
  'https://vattentrygg.se',
  'https://www.vattentrygg.se',
]);

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.connection?.remoteAddress || req.socket?.remoteAddress || req.ip || '';
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function toDayUTC(dateMs) {
  const d = new Date(typeof dateMs === 'number' ? dateMs : Date.now());
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Minimal continents-mappning (kan byggas ut vid behov)
const COUNTRY_TO_CONTINENT = {
  SE:'EU', NO:'EU', DK:'EU', FI:'EU', IS:'EU', DE:'EU', FR:'EU', NL:'EU', BE:'EU', LU:'EU',
  AT:'EU', CH:'EU', IT:'EU', ES:'EU', PT:'EU', IE:'EU', GB:'EU', PL:'EU', CZ:'EU', SK:'EU',
  HU:'EU', SI:'EU', HR:'EU', BA:'EU', RS:'EU', BG:'EU', RO:'EU', GR:'EU', EE:'EU', LV:'EU',
  LT:'EU', UA:'EU',
  US:'NA', CA:'NA', MX:'NA',
  BR:'SA', AR:'SA', CL:'SA', CO:'SA', PE:'SA', UY:'SA', PY:'SA', BO:'SA', VE:'SA', EC:'SA',
  CN:'AS', JP:'AS', KR:'AS', IN:'AS', SG:'AS', HK:'AS', TW:'AS', TH:'AS', MY:'AS', ID:'AS', PH:'AS', SA:'AS', AE:'AS', IL:'AS', TR:'AS',
  ZA:'AF', NG:'AF', EG:'AF', MA:'AF', KE:'AF', GH:'AF', DZ:'AF', TN:'AF', ET:'AF',
  AU:'OC', NZ:'OC'
};

// Hjälper: extrahera hostname från text/URL
function toHostname(v) {
  if (!v || typeof v !== 'string') return null;
  let s = v.trim();
  // om det är en URL, använd URL-parser; annars gissa att det är hostname redan
  try { s = new URL(s).hostname; } catch {}
  // ta bort ev. ledande www.
  s = s.replace(/^www\./i, '');
  // enkel validering
  if (!/^[a-z0-9.-]+$/i.test(s)) return null;
  return s.toLowerCase();
}

// Härled kundens tillåtna domäner från kundprofilen (utan att gissa fältnamn för hårt)
function extractCustomerSites(customer) {
  const out = new Set();

  // Kandidatfält (vanliga namn)
  const candidates = [
    customer.domain,
    customer.website,
    customer.site,
    customer.hostname,
    customer.host,
    customer.shopDomain,
  ];

  // Arrays med domäner
  if (Array.isArray(customer.domains)) candidates.push(...customer.domains);
  if (Array.isArray(customer.sites)) candidates.push(...customer.sites);
  if (Array.isArray(customer.hostnames)) candidates.push(...customer.hostnames);

  for (const v of candidates) {
    const h = toHostname(v);
    if (h) out.add(h);
  }

  return [...out];
}

// POST /api/pageviews/track
// Tar emot events från vattentrygg.se (endast efter CMP-consent på klientsidan)
router.post('/track', express.json({ limit: '32kb' }), async (req, res) => {
  // Snabb origin-kontroll (server-side guard utöver CORS)
  const origin = req.get('origin');
  if (origin && !ORIGIN_WHITELIST.has(origin)) {
    return res.status(403).json({ success: false, error: 'Origin ej tillåten' });
  }

  try {
    const {
      site,
      url,
      referrer = '',
      title = '',
      ts = Date.now(),
      ua = req.headers['user-agent'] || '',
      consent = false,
      viewport = {}
    } = req.body || {};

    // No-consent: släpp tyst (204) utan att spara
    if (!consent) return res.status(204).end();

    // Botfilter
    if (BOT_UA.test(ua || '')) return res.status(204).end();

    // Kräver IP_SALT för hashing
    const salt = process.env.IP_SALT || '';
    if (!salt) {
      console.warn('⚠️ IP_SALT saknas – avbryter tracking');
      return res.status(204).end();
    }

    const ip = getClientIp(req);
    const ip_hash = ip ? sha256Hex(`${ip}${salt}`) : null;
    const ua_hash = ua ? sha256Hex(`${ua}${salt}`) : null;
    const day = toDayUTC(ts);

    // Geo (lagra endast aggregerbara fält, aldrig rå IP)
    let country, region, city, continent;
    try {
      const cfCountry = req.headers['cf-ipcountry'];
      if (typeof cfCountry === 'string' && cfCountry.length === 2) {
        country = cfCountry.toUpperCase();
      }
      if (!country && geoip && ip) {
        const g = geoip.lookup(ip); // { country, region, city, ll, ... }
        if (g) {
          country = g.country || country;
          region = g.region || undefined;
          city = g.city || undefined;
        }
      }
      if (country) {
        continent = COUNTRY_TO_CONTINENT[country];
      }
    } catch { /* tyst fail */ }

    // Grundvalidering
    if (!site || !url) {
      return res.status(400).json({ success: false, error: 'site och url krävs' });
    }

    await PageviewEvent.create({
      site: toHostname(site) || site,
      url,
      referrer,
      title,
      ts: new Date(ts),
      ua,
      ip_hash,
      ua_hash,
      day,
      consent: true,
      // Geo
      country,
      region,
      city,
      continent,
      // viewport sparas ej (kan adderas i schema om du vill)
    });

    return res.status(201).json({ success: true });
  } catch (err) {
    console.error('❌ Fel i /api/pageviews/track:', err);
    return res.status(200).json({ success: false });
  }
});

// ======== Hjälpfunktion för match-objekt (kundbunden) =========
async function buildCustomerMatch(req, daysDefault = 30) {
  const userId = req.session?.user?._id;
  if (!userId) {
    const err = new Error('Inte inloggad');
    err.status = 401;
    throw err;
  }

  const customer = await Customer.findById(userId).lean();
  if (!customer) {
    const err = new Error('Kund hittades inte');
    err.status = 404;
    throw err;
  }

  const sites = extractCustomerSites(customer);
  if (!sites.length) {
    const err = new Error('Ingen domän kopplad till detta konto');
    err.status = 400;
    throw err;
  }

  const days = Math.max(1, Math.min(180, parseInt(req.query.days, 10) || daysDefault));
  const end = new Date();
  const start = new Date();
  start.setUTCDate(end.getUTCDate() - (days - 1));
  start.setUTCHours(0, 0, 0, 0);

  return {
    match: { ts: { $gte: start, $lte: end }, site: { $in: sites } },
    days,
    sites
  };
}

// ======== Kundbunden sammanfattning: /summary/me =========
// GET /api/pageviews/summary/me?days=7
router.get('/summary/me', async (req, res) => {
  try {
    const { match } = await buildCustomerMatch(req, 7);

    const byDay = await PageviewEvent.aggregate([
      { $match: match },
      { $group: { _id: '$day', count: { $sum: 1 }, visitors: { $addToSet: '$ip_hash' } } },
      { $project: { _id: 1, count: 1, uniqueVisitors: { $size: '$visitors' } } },
      { $sort: { _id: 1 } }
    ]);

    const topUrls = await PageviewEvent.aggregate([
      { $match: match },
      { $group: { _id: '$url', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]);

    const topRef = await PageviewEvent.aggregate([
      { $match: match },
      { $group: { _id: { $ifNull: ['$referrer', ''] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]);

    return res.json({ success: true, byDay, topUrls, topRef });
  } catch (err) {
    const code = err.status || 500;
    if (code !== 500) return res.status(code).json({ success: false, error: err.message });
    console.error('❌ Fel i /api/pageviews/summary/me:', err);
    return res.status(500).json({ success: false, error: 'Serverfel' });
  }
});

// ======== Kundbunden geo: /geo/me =========
// GET /api/pageviews/geo/me?days=30
router.get('/geo/me', async (req, res) => {
  try {
    const { match } = await buildCustomerMatch(req, 30);

    const totalsAgg = await PageviewEvent.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: 1 }, uniqueIps: { $addToSet: '$ip_hash' } } },
      { $project: { _id: 0, total: 1, uniqueVisitors: { $size: '$uniqueIps' } } }
    ]);
    const totals = totalsAgg[0] || { total: 0, uniqueVisitors: 0 };

    const perCountry = await PageviewEvent.aggregate([
      { $match: match },
      { $group: { _id: { $ifNull: ['$country', 'XX'] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    const countries = perCountry.map(row => ({
      country: row._id,
      count: row.count,
      percent: totals.total ? Math.round((row.count / totals.total) * 1000) / 10 : 0
    }));

    return res.json({ success: true, totals, countries });
  } catch (err) {
    const code = err.status || 500;
    if (code !== 500) return res.status(code).json({ success: false, error: err.message });
    console.error('❌ Fel i /api/pageviews/geo/me:', err);
    return res.status(500).json({ success: false, error: 'Serverfel' });
  }
});

// ======== Bakåtkompatibla endpoints (site-query) =========

// GET /api/pageviews/summary?days=7&site=exempel.se
router.get('/summary', async (req, res) => {
  try {
    const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 7));
    const site = (req.query.site || '').trim();

    const end = new Date();
    const start = new Date();
    start.setUTCDate(end.getUTCDate() - (days - 1));
    start.setUTCHours(0, 0, 0, 0);

    const match = { ts: { $gte: start, $lte: end } };
    if (site) match.site = toHostname(site) || site;

    const byDay = await PageviewEvent.aggregate([
      { $match: match },
      { $group: { _id: '$day', count: { $sum: 1 }, visitors: { $addToSet: '$ip_hash' } } },
      { $project: { _id: 1, count: 1, uniqueVisitors: { $size: '$visitors' } } },
      { $sort: { _id: 1 } }
    ]);

    const topUrls = await PageviewEvent.aggregate([
      { $match: match },
      { $group: { _id: '$url', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]);

    const topRef = await PageviewEvent.aggregate([
      { $match: match },
      { $group: { _id: { $ifNull: ['$referrer', ''] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]);

    return res.json({ success: true, byDay, topUrls, topRef });
  } catch (err) {
    console.error('❌ Fel i /api/pageviews/summary:', err);
    return res.status(500).json({ success: false, error: 'Serverfel' });
  }
});

// GET /api/pageviews/geo?days=30&site=exempel.se
router.get('/geo', async (req, res) => {
  try {
    const days = Math.max(1, Math.min(180, parseInt(req.query.days, 10) || 30));
    const site = (req.query.site || '').trim();

    const end = new Date();
    const start = new Date();
    start.setUTCDate(end.getUTCDate() - (days - 1));
    start.setUTCHours(0, 0, 0, 0);

    const match = { ts: { $gte: start, $lte: end } };
    if (site) match.site = toHostname(site) || site;

    const totalsAgg = await PageviewEvent.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: 1 }, uniqueIps: { $addToSet: '$ip_hash' } } },
      { $project: { _id: 0, total: 1, uniqueVisitors: { $size: '$uniqueIps' } } }
    ]);
    const totals = totalsAgg[0] || { total: 0, uniqueVisitors: 0 };

    const perCountry = await PageviewEvent.aggregate([
      { $match: match },
      { $group: { _id: { $ifNull: ['$country', 'XX'] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    const countries = perCountry.map(row => ({
      country: row._id,
      count: row.count,
      percent: totals.total ? Math.round((row.count / totals.total) * 1000) / 10 : 0
    }));

    return res.json({ success: true, totals, countries });
  } catch (err) {
    console.error('❌ Fel i /api/pageviews/geo:', err);
    return res.status(500).json({ success: false, error: 'Serverfel' });
  }
});

module.exports = router;
