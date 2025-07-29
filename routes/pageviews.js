const express = require("express");
const router = express.Router();
const PageView = require("../models/PageView");
const Customer = require("../models/Customer");

// GET /api/pageviews/summary
router.get("/summary", async (req, res) => {
  const user = req.session?.user;

  if (!user || !user.email) {
    return res.status(401).json({ error: "Inte inloggad" });
  }

  try {
    const customer = await Customer.findOne({ email: user.email });

    if (!customer || !customer._id) {
      return res.status(404).json({ error: "Kund hittades inte" });
    }

    const today = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 6); // inkluderar idag

    const result = await PageView.aggregate([
      {
        $match: {
          customerId: customer._id,
          timestamp: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$timestamp" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // GET /api/pageviews/insights
router.get("/insights", async (req, res) => {
  const user = req.session?.user;

  if (!user || !user.email) {
    return res.status(401).json({ error: "Inte inloggad" });
  }

  try {
    const customer = await Customer.findOne({ email: user.email });
    if (!customer) {
      return res.status(404).json({ error: "Kund hittades inte" });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startOfThisWeek = new Date(today);
    startOfThisWeek.setDate(today.getDate() - 6);

    const startOfLastWeek = new Date(today);
    startOfLastWeek.setDate(today.getDate() - 13);

    const endOfLastWeek = new Date(today);
    endOfLastWeek.setDate(today.getDate() - 7);

    // Visningar idag
    const todayCount = await PageView.countDocuments({
      customerId: customer._id,
      timestamp: { $gte: today }
    });

    // Visningar senaste 7 dagar
    const thisWeekCount = await PageView.countDocuments({
      customerId: customer._id,
      timestamp: { $gte: startOfThisWeek }
    });

    // Visningar veckan före
    const lastWeekCount = await PageView.countDocuments({
      customerId: customer._id,
      timestamp: {
        $gte: startOfLastWeek,
        $lt: endOfLastWeek
      }
    });

    const percentChange =
      lastWeekCount === 0
        ? null
        : Math.round(((thisWeekCount - lastWeekCount) / lastWeekCount) * 100);

    res.json({
      todayCount,
      percentChange,
      thisWeekCount,
      lastWeekCount
    });

  } catch (err) {
    console.error("❌ Fel vid insights-analys:", err);
    res.status(500).json({ error: "Serverfel" });
  }
});

    // Format: { '2025-07-22': 120, '2025-07-23': 95, ... }
    const countsMap = result.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    // Fyll i nollor för dagar utan visningar
    const labels = [];
    const counts = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      const label = d.toISOString().split("T")[0];
      labels.push(label);
      counts.push(countsMap[label] || 0);
    }

// Räkna hur många visningar som skett idag från 00:00
const startOfToday = new Date();
startOfToday.setUTCHours(0, 0, 0, 0);

const todaysCount = await PageView.countDocuments({
  customerId: customer._id,
  timestamp: { $gte: startOfToday }
});

    res.json({ labels, counts, todaysCount });

  } catch (err) {
    console.error("❌ Fel vid hämtning av pageviews:", err);
    res.status(500).json({ error: "Serverfel" });
  }
});

module.exports = router;
