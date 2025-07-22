console.log("🔐 API-nyckel som används:", process.env.OPENAI_API_KEY);
const express = require("express");
const dotenv = require("dotenv");
const { Configuration, OpenAIApi } = require("openai");
const Customer = require("../models/Customer");
const Message = require("../models/Message");

dotenv.config();

const router = express.Router();

// 🔑 OpenAI-setup
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


router.post("/ask", async (req, res) => {
  const { message } = req.body;
  const sessionUser = req.session.user;

  if (!sessionUser || !sessionUser.email) {
    return res.status(401).json({ reply: "❌ Du är inte inloggad." });
  }

  try {
    const customer = await Customer.findOne({ email: sessionUser.email });
    if (!customer) {
      return res
        .status(404)
        .json({ reply: "❌ Kunde inte hitta kunddata." });
    }

    // 🧠 Systemprompt med kundinfo
    const systemPrompt = `
Du är en hjälpsam, tillmötesgående och vänlig AI-supportagent i en kundportal. Du svarar kortfattat men trevligt – på ett sätt som känns mänskligt och professionellt.

Du ska aldrig svara på frågor om lösenord, PIN-koder eller annan känslig data. Be istället kunden kontakta en riktig supportperson vid sådana frågor.

Användarens information:
- Namn: ${customer.name}
- E-post: ${customer.email}
- Kampanjer: ${customer.campaigns?.join(", ") || "Ingen information"}
- Bransch: ${customer.industry || "Ej angivet"}
- Webbplats: ${customer.website || "Ej angiven"}
- Skapad: ${customer.createdAt?.toISOString().split("T")[0] || "Okänt"}
- Senast inloggad: ${customer.lastLogin?.toISOString().split("T")[0] || "Okänt"}
- Plan: ${customer.plan || "Gratis"}
- Anteckningar: ${customer.notes || "Inga"}
`;

const completion = await openai.chat.completions.create({
  model: "gpt-3.5-turbo",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: message },
  ],
  temperature: 0.7,
});


if (!completion || !completion.choices || !completion.choices[0]) {
  console.error("❌ OpenAI-svaret saknar choices:", completion);
  return res.status(500).json({ reply: "❌ AI-svar saknas eller var ogiltigt." });
}

const reply = completion.choices[0].message.content;

    res.json({ reply: reply || "⚠️ Inget svar från AI." });
  } catch (err) {
    console.error("❌ Fel vid AI-anrop:", err);
    res
      .status(500)
      .json({ reply: "❌ Ett fel uppstod vid kontakt med AI." });
  }
});

router.get("/customer/:id", async (req, res) => {
  const { id } = req.params;
  const { sessionId } = req.query;

  const query = { customerId: id };
  if (sessionId) {
    query.sessionId = sessionId;
  }

  try {
    const messages = await Message.find(query).sort({ timestamp: 1 });
    res.json(messages);
  } catch (err) {
    console.error("❌ Kunde inte hämta meddelanden:", err);
    res.status(500).json({ error: "Kunde inte hämta meddelanden" });
  }
});


// POST /api/chat
router.post("/", async (req, res) => {
  const { customerId, message, sender, timestamp } = req.body;

  if (!customerId || !message || !sender) {
    return res.status(400).json({ error: "Meddelande saknar information" });
  }

  try {
    const newMsg = await Message.create({
      customerId,
      message,
      sender,
      timestamp: timestamp || new Date()
    });

    res.status(201).json(newMsg);
  } catch (err) {
    console.error("❌ Kunde inte spara meddelande:", err);
    res.status(500).json({ error: "Serverfel" });
  }
});

router.get("/me", async (req, res) => {
  if (!req.session || !req.session.user || !req.session.user.email) {
    return res.status(401).json({ error: "Inte inloggad" });
  }

  try {
    const customer = await Customer.findOne({ email: req.session.user.email });

    if (!customer) {
      return res.status(404).json({ error: "Kund hittades inte" });
    }

    res.json(customer);
  } catch (err) {
    console.error("❌ Fel vid hämtning av kunddata:", err);
    res.status(500).json({ error: "Serverfel vid kundhämtning" });
  }
});

module.exports = router;
