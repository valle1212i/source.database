const express = require("express");
const dotenv = require("dotenv");
const { Configuration, OpenAIApi } = require("openai");
const Customer = require("../models/Customer");
const Message = require("../models/Message");

dotenv.config();
const router = express.Router();

// 🔑 OpenAI setup
const OpenAI = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// POST /api/chat/ask
router.post("/ask", async (req, res) => {
  const { message } = req.body;
  const sessionUser = req.session?.user;

  if (!sessionUser?.email) {
    return res.status(401).json({ reply: "❌ Du är inte inloggad." });
  }

  try {
    const customer = await Customer.findOne({ email: sessionUser.email });
    if (!customer) {
      return res.status(404).json({ reply: "❌ Kunde inte hitta kunddata." });
    }

    const systemPrompt = `
You are a helpful, professional and friendly AI assistant inside a customer portal. 
Always answer in the same language the user used in their message (e.g. Swedish, English, Spanish, German, etc.).

Never provide or guess passwords, PINs or sensitive data. If the user asks for such information, tell them to contact human support instead.

Here is the user's profile information (in Swedish – do not translate it):

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

    const history = req.session.aiHistory || [];
    const chatMessages = [
      { role: "system", content: systemPrompt },
      ...history.flatMap(entry => [
        { role: "user", content: entry.question },
        { role: "assistant", content: entry.answer }
      ]),
      { role: "user", content: message }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: chatMessages,
      temperature: 0.7,
    });

    const reply = completion.choices?.[0]?.message?.content || "⚠️ Inget svar från AI.";

    if (!req.session.aiHistory) req.session.aiHistory = [];
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

// POST /api/chat
router.post("/", async (req, res) => {
  const { message, sender = "customer", sessionId } = req.body;
  const user = req.session?.user;

  if (!user?. _id || !message || !sender) {
    return res.status(400).json({ error: "Saknar obligatorisk information eller ej inloggad" });
  }

  try {
    const newMsg = await Message.create({
      customerId: user._id,
      message,
      sender,
      timestamp: new Date(),
      sessionId
    });

    res.status(201).json(newMsg);
  } catch (err) {
    console.error("❌ Kunde inte spara meddelande:", err);
    res.status(500).json({ error: "Serverfel vid sparning" });
  }
});

// GET /api/chat/customer/me?sessionId=abc123
router.get("/customer/me", async (req, res) => {
  const user = req.session?.user;
  const sessionId = req.query.sessionId;

  if (!user?. _id) {
    return res.status(401).json({ error: "Inte inloggad" });
  }

  const query = { customerId: user._id };
  if (sessionId) query.sessionId = sessionId;

  try {
    const messages = await Message.find(query).sort({ timestamp: 1 });
    res.json(messages);
  } catch (err) {
    console.error("❌ Kunde inte hämta meddelanden:", err);
    res.status(500).json({ error: "Serverfel vid meddelandehämtning" });
  }
});

// (Valfritt: ta bort denna när du bytt till /customer/me överallt)
router.get("/customer/:id", async (req, res) => {
  const { id } = req.params;
  const { sessionId } = req.query;

  const query = { customerId: id };
  if (sessionId) query.sessionId = sessionId;

  try {
    const messages = await Message.find(query).sort({ timestamp: 1 });
    res.json(messages);
  } catch (err) {
    console.error("❌ Kunde inte hämta meddelanden:", err);
    res.status(500).json({ error: "Kunde inte hämta meddelanden" });
  }
});

// GET /api/chat/me – Returnera inloggad användare (för ev. frontend)
router.get("/me", async (req, res) => {
  const user = req.session?.user;

  if (!user?.email) {
    return res.status(401).json({ error: "Inte inloggad" });
  }

  try {
    const customer = await Customer.findOne({ email: user.email });
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
