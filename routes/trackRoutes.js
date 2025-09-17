const express = require("express");
const router = express.Router();
const Customer = require("../models/Customer");
const PageView = require("../models/PageView"); // bör ha fält: customerId, url, path, title, ref, uid, ts
const { Types } = require("mongoose");

// Hjälp: plocka hostname ur valfri URL
function getHostname(str) {
  try { return new URL(str).hostname.replace(/^www\./, ""); }
  catch { return null; }
}

// Hjälp: start på dag (för unik-dämpning och aggregering)
function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// 🔴 POST /api/pageviews/track
// Payload förslagsvis: { siteId?, url, path?, title?, ref?, uid?, ts? }
router.post("/track", async (req, res) => {
  try {
    const { siteId, url, path, title, ref, uid, ts } = req.body || {};
    const now = ts ? new Date(ts) : new Date();

    if (!url) return res.status(400).json({ success: false, message: "Ingen URL angiven" });

    // 1) Hitta kund
    let customerId = null;

    if (siteId && Types.ObjectId.isValid(siteId)) {
      const c = await Customer.findById(siteId).select("_id");
      if (c) customerId = c._id;
    }

    if (!customerId) {
      // Falla tillbaka till domänmatchning
      const host = getHostname(url);
      if (!host) return res.status(400).json({ success: false, message: "Ogiltig URL" });

      // Hämta kund vars website-domän matchar (robust mot https/http och trailing slash)
      // Antag att Customer.website innehåller en full URL – jämför på hostname
      const candidate = await Customer.findOne({ website: { $exists: true, $ne: null } })
        .sort({ updatedAt: -1 }); // snabbast möjliga enkla kandidat; förbättra gärna med indexerat fält 'websiteHost'

      // Om du har många kunder: läs fler kandidater och jämför i kod
      // Här gör vi en enkel “bästa försök”-match
      if (candidate) {
        try {
          const custHost = getHostname(candidate.website);
          if (custHost && custHost === host) customerId = candidate._id;
        } catch {}
      }

      if (!customerId) {
        return res.status(404).json({ success: false, message: "Kund kunde inte härledas från URL/domän" });
      }
    }

    // 2) Enkel dämpning: max 1 visning per (uid, path, dag)
    const dayKey = startOfDay(now).getTime();
    const uniqueKey = uid && path ? `${customerId}:${uid}:${path}:${dayKey}` : null;

    // Har du en model för unika? Annars använd PageView med unik index (rekommenderas: separat collection)
    // Här gör vi mjuk dämpning i applikationslogiken:
    if (uniqueKey) {
      const exists = await PageView.findOne({
        customerId,
        uid,
        path: path || new URL(url).pathname,
        dayKey
      }).select("_id");
      if (!exists) {
        await PageView.create({
          customerId,
          url,
          path: path || new URL(url).pathname,
          title: title || null,
          ref: ref || null,
          uid: uid || null,
          ts: now,
          dayKey
        });
        // Live-push om Socket.IO finns monterad på appen
        req.app.get("io")?.to(`site:${String(customerId)}`).emit("pageview:new", {
          customerId: String(customerId),
          at: Date.now(),
          path: path || new URL(url).pathname
        });
      }
    } else {
      // Om vi saknar uid/path – räkna som vanlig visning
      await PageView.create({
        customerId,
        url,
        path: path || new URL(url).pathname,
        title: title || null,
        ref: ref || null,
        uid: uid || null,
        ts: now,
        dayKey
      });
      req.app.get("io")?.to(`site:${String(customerId)}`).emit("pageview:new", {
        customerId: String(customerId),
        at: Date.now(),
        path: path || new URL(url).pathname
      });
    }

    res.json({ success: true, message: "Sidvisning registrerad" });
  } catch (err) {
    console.error("❌ Fel vid spårning:", err);
    res.status(500).json({ success: false, message: "Serverfel" });
  }
});

// 🟡 GET /api/pageviews/summary?customerId=... | ?siteId=... | ?days=7
// Returnerar { labels, counts, todaysCount, activeNow }
router.get("/summary", async (req, res) => {
  try {
    const { customerId: qCustomerId, siteId: qSiteId } = req.query;
    const days = Math.min(parseInt(req.query.days || "7", 10), 60);

    let customerId = null;
    if (qCustomerId && Types.ObjectId.isValid(qCustomerId)) customerId = qCustomerId;
    else if (qSiteId && Types.ObjectId.isValid(qSiteId)) customerId = qSiteId;
    else {
      // Om ni har en inloggad kund i portalen, hämta den i en “me”-endpoint istället
      return res.status(400).json({ success: false, message: "customerId eller siteId krävs" });
    }

    const since = startOfDay(new Date(Date.now() - (days - 1) * 24 * 3600 * 1000));
    const todayStart = startOfDay(new Date());

    // Grupp per dag (via dayKey som är start-of-day ms)
    const agg = await PageView.aggregate([
      { $match: { customerId: Types.ObjectId(customerId), ts: { $gte: since } } },
      { $group: { _id: "$dayKey", count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    // Packa labels/counts med luckor fyllda
    const labels = [];
    const counts = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      const key = startOfDay(d).getTime();
      const hit = agg.find(a => a._id === key);
      labels.push(d.toISOString());
      counts.push(hit ? hit.count : 0);
    }

    const todaysCount = await PageView.countDocuments({
      customerId: Types.ObjectId(customerId),
      ts: { $gte: todayStart }
    });

    // “Aktiva nu” = senaste 5 min
    const activeNow = await PageView.countDocuments({
      customerId: Types.ObjectId(customerId),
      ts: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
    });

    res.json({ success: true, labels, counts, todaysCount, activeNow, customerId, days });
  } catch (err) {
    console.error("❌ summary-fel:", err);
    res.status(500).json({ success: false, message: "Serverfel" });
  }
});

// 🧪 GET /api/pageviews/all  (debug)
router.get("/all", async (req, res) => {
  const data = await PageView.find().sort({ ts: -1 }).limit(50);
  res.json(data);
});

module.exports = router;
