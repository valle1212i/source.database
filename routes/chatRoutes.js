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
      return res.status(404).json({ reply: "❌ Kunde inte hitta kunddata." });
    }

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

    // 1. Flytta ut history
    const history = req.session.aiHistory || [];

    // 2. Bygg chatMessages korrekt
    const chatMessages = [
      { role: "system", content: systemPrompt },
      ...history.flatMap(entry => [
        { role: "user", content: entry.question },
        { role: "assistant", content: entry.answer }
      ]),
      { role: "user", content: message }
    ];

    // 3. Skicka med messages till OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: chatMessages,
      temperature: 0.7,
    });

    // 4. Svarshantering och historik
    const reply = completion.choices?.[0]?.message?.content || "⚠️ Inget svar från AI.";

    if (!req.session.aiHistory) {
      req.session.aiHistory = [];
    }

    req.session.aiHistory.push({
      question: message,
      answer: reply,
      timestamp: new Date()
    });

    res.json({ reply });

  } catch (err) {
    console.error("❌ Fel vid AI-anrop:", err);
    res.status(500).json({ reply: "❌ Ett fel uppstod vid kontakt med AI." });
  }
});

router.get("/customer/:id", async (req, res) => {
  try {
    const customerId = req.params.id;
    const messages = await Message.find({ customerId }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (err) {
    console.error("❌ Kunde inte hämta meddelanden:", err);
    res.status(500).json({ error: "Kunde inte hämta meddelanden" });
  }
});

module.exports = router;
