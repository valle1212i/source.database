const express = require("express");
const dotenv = require("dotenv");
const { Configuration, OpenAIApi } = require("openai");
const Customer = require("../models/Customer");
const Message = require("../models/Message");

dotenv.config();
const router = express.Router();

// 🔑 OpenAI setup
const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));

// 🧠 POST /api/chat/ask — AI-fråga
router.post("/ask", async (req, res) => {
  const { message } = req.body;
  const sessionUser = req.session?.user;

  if (!sessionUser?.email) return res.status(401).json({ reply: "❌ Du är inte inloggad." });

  try {
    const customer = await Customer.findOne({ email: sessionUser.email });
    if (!customer) return res.status(404).json({ reply: "❌ Kunde inte hitta kunddata." });

    const systemPrompt = `
Du är en hjälpsam AI-assistent. Svara alltid på samma språk som användarens meddelande. 
Gissa aldrig känslig information. Vid sådana frågor, be användaren kontakta support.

Profilinfo:
- Namn: ${customer.name}
- E-post: ${customer.email}
- Kampanjer: ${customer.campaigns?.join(", ") || "Ingen info"}
- Plan: ${customer.plan || "Gratis"}
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

    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: chatMessages,
      temperature: 0.7,
    });

    const reply = completion.data.choices?.[0]?.message?.content || "⚠️ Inget svar från AI.";

    req.session.aiHistory = [...(req.session.aiHistory || []), { question: message, answer: reply }];

    res.json({ reply });
  } catch (err) {
    console.error("❌ Fel vid AI-anrop:", err);
    res.status(500).json({ reply: "❌ Ett fel uppstod vid kontakt med AI." });
  }
});


// ✉️ POST /api/chat — Spara meddelande
router.post("/", async (req, res) => {
  const { message, sender = "customer", sessionId, customerId } = req.body;
  const user = req.session?.user;

  const finalCustomerId = customerId || user?._id;

  if (!finalCustomerId || !message || !sender || !sessionId) {
    return res.status(400).json({ error: "Saknar obligatorisk data" });
  }

  try {
    const newMsg = await Message.create({
      customerId: finalCustomerId,
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

// 💬 GET /api/chat/customer/me?sessionId=
router.get("/customer/me", async (req, res) => {
  const user = req.session?.user;
  const sessionId = req.query.sessionId;

  if (!user?._id) return res.status(401).json({ error: "Inte inloggad" });

  const query = { customerId: user._id };
  if (sessionId) query.sessionId = sessionId;

  try {
    const messages = await Message.find(query).sort({ timestamp: 1 });
    res.json(messages);
  } catch (err) {
    console.error("❌ Kunde inte hämta meddelanden:", err);
    res.status(500).json({ error: "Serverfel vid hämtning" });
  }
});

// 🧾 GET /api/chat/customer/:id?sessionId=
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
    res.status(500).json({ error: "Fel vid meddelandehämtning" });
  }
});

// 🙋‍♀️ GET /api/chat/me — Returnera kundobjekt
router.get("/me", async (req, res) => {
  const user = req.session?.user;

  if (!user?.email) return res.status(401).json({ error: "Inte inloggad" });

  try {
    const customer = await Customer.findOne({ email: user.email });
    if (!customer) return res.status(404).json({ error: "Kund hittades inte" });

    res.json(customer);
  } catch (err) {
    console.error("❌ Fel vid kundhämtning:", err);
    res.status(500).json({ error: "Serverfel vid kundhämtning" });
  }
});

module.exports = router;
