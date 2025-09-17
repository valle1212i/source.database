const express = require("express");
const router = express.Router();
const Pageview = require("../models/PageView");
const Customer = require("../models/Customer");
const { URL } = require("url");

// Hjälp
function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0,0,0,0); return x; }

// POST /api/pageviews/track
// Stöder både gammal payload { url, page, referrer, visitorId }
// och ny payload { url, path, ref, uid, ts, siteId? }
router.post("/track", async (req, res) => {
  try {
    const { url, page, referrer, visitorId, path, ref, uid, ts, siteId } = req.body || {};
    const finalUrl = url;
    if (!finalUrl) return res.status(400).json({ success: false, message: "Saknar url" });

    const now = ts ? new Date(ts) : new Date();
    const hostname = new URL(finalUrl).hostname.replace(/^www\./, "");
    const finalPath = path || page || new URL(finalUrl).pathname;
    const finalRef = ref ?? referrer ?? null;
    const finalUid = uid ?? visitorId ?? null;

    // 1) Hitta kund: siteId om ni vill (ObjectId), annars hostname-match
    let customer = null;
    if (siteId) {
      customer = await Customer.findById(siteId).select("_id website");
    }
    if (!customer) {
      customer = await Customer.findOne({
        website: { $regex: hostname, $options: "i" }
      }).select("_id website");
    }
    if (!customer) {
      console.warn("🔍 Ingen kund matchade:", hostname);
      return res.status(404).json({ success: false, message: "Kund hittades inte" });
    }

    // 2) (Valfritt) Dämpa: max 1 visning per (kund, uid, path, dag)
    const dayKey = startOfDay(now).getTime();
    if (finalUid) {
      const exists = await Pageview.exists({
        customerId: customer._id,
        uid: finalUid,
        path: finalPath,
        dayKey
      });
      if (!exists) {
        await Pageview.create({
          customerId: customer._id,
          url: finalUrl,
          path: finalPath,
          ref: finalRef,
          uid: finalUid,
          ts: now,
          dayKey
        });
        // Live push om Socket.IO är kopplat i appen (app.set('io', io))
        req.app.get("io")?.to(`site:${String(customer._id)}`).emit("pageview:new", {
          customerId: String(customer._id),
          at: Date.now(),
          path: finalPath
        });
      }
    } else {
      // Om ingen uid – räkna som vanlig visning
      await Pageview.create({
        customerId: customer._id,
        url: finalUrl,
        path: finalPath,
        ref: finalRef,
        uid: null,
        ts: now,
        dayKey
      });
      req.app.get("io")?.to(`site:${String(customer._id)}`).emit("pageview:new", {
        customerId: String(customer._id),
        at: Date.now(),
        path: finalPath
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Fel vid spårning:", err);
    res.status(500).json({ success: false, message: "Serverfel vid spårning" });
  }
});

// GET /api/pageviews/summary?customerId=<id>&days=7
router.get("/summary", async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days || "7", 10), 60);
    const customerId = req.query.customerId || req.query.siteId; // stöd för båda
    if (!customerId) return res.status(400).json({ success:false, message:"customerId krävs" });

    const since = startOfDay(new Date(Date.now() - (days - 1) * 24 * 3600 * 1000));
    const todayStart = startOfDay(new Date());

    // Aggregera per dag via dayKey
    const agg = await Pageview.aggregate([
      { $match: { customerId: Customer.db.base.Types.ObjectId(customerId), ts: { $gte: since } } },
      { $group: { _id: "$dayKey", count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

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

    const todaysCount = await Pageview.countDocuments({
      customerId,
      ts: { $gte: todayStart }
    });

    const activeNow = await Pageview.countDocuments({
      customerId,
      ts: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
    });

    res.json({ labels, counts, todaysCount, activeNow, success:true, days, customerId });
  } catch (err) {
    console.error("❌ summary-fel:", err);
    res.status(500).json({ success:false, message:"Serverfel" });
  }
});

// (valfritt) Debug
router.get("/all", async (req, res) => {
  const data = await Pageview.find().sort({ ts: -1 }).limit(50);
  res.json(data);
});

module.exports = router;


router.post("/track", async (req, res) => {
  try {
    const { url, page, referrer, visitorId } = req.body;

    if (!url || !visitorId) {
      return res.status(400).json({ success: false, message: "Saknar nödvändig data" });
    }

    const hostname = new URL(url).hostname.replace(/^www\./, "");

    const customer = await Customer.findOne({
      website: { $regex: hostname, $options: "i" }
    });

    if (!customer) {
      console.warn("🔍 Ingen kund matchade värddelen:", hostname);
      return res.status(404).json({ success: false, message: "Kund hittades inte" });
    }

    await Pageview.create({
      customerId: customer._id,
      url,
      page,
      referrer,
      visitorId,
      timestamp: new Date(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Fel vid spårning:", err);
    res.status(500).json({ success: false, message: "Serverfel vid spårning" });
  }
});

module.exports = router;
