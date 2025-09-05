const express = require("express");
const dotenv = require("dotenv");
const OpenAI = require("openai");
const Customer = require("../models/Customer");
const Message = require("../models/Message");
const requireAuth = require('../middleware/requireAuth');

dotenv.config();
const router = express.Router();

// 🔑 OpenAI setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


// 🧠 POST /api/chat/ask — AI-fråga
router.post("/ask", async (req, res) => {

  const sessionUser = req.session?.user;

  if (!sessionUser?.email) return res.status(401).json({ reply: "❌ Du är inte inloggad." });

  try {
    const customer = await Customer.findOne({ email: sessionUser.email });
    if (!customer) return res.status(404).json({ reply: "❌ Kunde inte hitta kunddata." });

// Validera & sanera inkommande meddelande
const rawMsg = typeof req.body?.message === "string" ? req.body.message : "";
let message = rawMsg.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
if (message.length > 1500) message = message.slice(0, 1500);
if (!message) return res.status(400).json({ reply: "❌ Ogiltigt meddelande." });

// Maska e-post (ex: jo***@gmail.com)
const maskedEmail = (customer.email || "").replace(/^(.{2}).+(@.*)$/,"$1***$2");

// Dataminimerad prompt (ingen domän)
const systemPrompt = `
Du är en hjälpsam AI-assistent. Svara alltid på samma språk som användaren.
Gissa aldrig känslig information. För känsliga ärenden: be användaren kontakta support.

Kundprofil:
- Namn: ${customer.name || "Okänt"}
- E-post (maskerad): ${maskedEmail || "Okänt"}
- Domän: ${customer.website || "Ingen angiven"}
- Kampanjer: ${customer.campaigns?.join(", ") || "Ingen info"}
- Plan: ${customer.plan || "Gratis"}
`;

// Begränsa historik (senaste 10) och bygg messages — trimma långa inlägg
const history = (req.session.aiHistory || []).slice(-10);
const chatMessages = [
  { role: "system", content: systemPrompt },
  ...history.flatMap(entry => [
    { role: "user", content: String(entry.question || "").slice(0, 800) },
    { role: "assistant", content: String(entry.answer || "").slice(0, 1200) }
  ]),
  { role: "user", content: message }
];

// Modell/limit/timeout via ENV med säkra default
const model = process.env.OPENAI_MODEL || "gpt-3.5-turbo";
const maxTokens = Number(process.env.OPENAI_MAX_TOKENS || 300);
const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 10000);

// Timeout med AbortController
const ac = new AbortController();
const to = setTimeout(() => ac.abort(), timeoutMs);

let reply = "⚠️ Inget svar från AI.";
try {
  const completion = await openai.chat.completions.create(
    {
      model,
      messages: chatMessages,
      temperature: 0.7,
      max_tokens: maxTokens,
    },
    { signal: ac.signal }
  );
  reply = completion?.choices?.[0]?.message?.content || reply;
} catch (err) {
  if (err.name === "AbortError") {
    reply = "⏱️ AI-tjänsten tog för lång tid att svara. Försök igen.";
  } else {
    reply = "❌ Ett fel uppstod vid AI-svar.";
  }
} finally {
  clearTimeout(to);
}

// Spara kapad historik + senaste frågan/svar
req.session.aiHistory = [...history, { question: message, answer: reply }];

    res.json({ reply });
  } catch (err) {
    console.error("❌ Fel vid AI-anrop:", err);
    res.status(500).json({ reply: "❌ Ett fel uppstod vid kontakt med AI." });
  }
});


// ✉️ POST /api/chat — Spara meddelande (härdad)
router.post("/", requireAuth, async (req, res) => {
  const user = req.session.user;
  const isAdmin = user?.role === "admin";

  // Plocka fält och sanera/validera
  const rawMsg = typeof req.body?.message === "string" ? req.body.message : "";
  // Enkel sanering: ta bort HTML-taggar, normalisera whitespace och trimma längd
  let message = rawMsg.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  if (message.length > 2000) message = message.slice(0, 2000);

  const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
  const senderReq = typeof req.body?.sender === "string" ? req.body.sender : "customer";
  const customerIdReq = req.body?.customerId;

  // Tvinga sender baserat på roll (kund kan inte spoofa admin/system)
  const sender = isAdmin ? (["admin", "customer", "system"].includes(senderReq) ? senderReq : "admin") : "customer";

  // Endast admin får sätta customerId; övriga tvingas till sitt eget
  const finalCustomerId = isAdmin ? (customerIdReq || user._id) : user._id;

  const errors = [];
  if (!finalCustomerId) errors.push("saknar customerId (session)");
  if (!message) errors.push("message måste vara 1–2000 tecken");
  if (!/^[A-Za-z0-9._-]{8,128}$/.test(sessionId)) errors.push("ogiltigt sessionId-format");

  if (errors.length) {
    return res.status(400).json({ error: "Ogiltig data", details: errors });
  }

  try {
    const doc = await Message.create({
      customerId: finalCustomerId,
      message,
      sender,
      timestamp: new Date(),
      sessionId
    });

    // Dataminimerat svar
    return res.status(201).json({
      _id: doc._id,
      message: doc.message,
      sender: doc.sender,
      timestamp: doc.timestamp,
      sessionId: doc.sessionId
    });
  } catch (err) {
    console.error("❌ Kunde inte spara meddelande:", err);
    return res.status(500).json({ error: "Serverfel vid sparning" });
  }
});

// 💬 GET /api/chat/customer/me?sessionId=
router.get("/customer/me", requireAuth, async (req, res) => {
  const user = req.session?.user;
  const sessionId = req.query.sessionId;

  if (!user?._id) return res.status(401).json({ error: "Inte inloggad" });

  // Validera sessionId om angivet
  if (typeof sessionId !== "undefined" && !/^[A-Za-z0-9._-]{8,128}$/.test(String(sessionId))) {
    return res.status(400).json({ error: "Ogiltigt sessionId-format" });
  }

  const query = { customerId: user._id };
  if (sessionId) query.sessionId = sessionId;

  try {
    const messages = await Message.find(query).sort({ timestamp: 1 });
    return res.json(messages.map(m => ({
      message: m.message,
      sender: m.sender,
      timestamp: m.timestamp,
      sessionId: m.sessionId
    })));
  } catch (err) {
    console.error("❌ Kunde inte hämta meddelanden:", err);
    return res.status(500).json({ error: "Serverfel vid hämtning" });
  }
});

// 🧾 GET /api/chat/customer/:id?sessionId=
router.get("/customer/:id", requireAuth, async (req, res) => {
  const isAdmin = req.session.user?.role === 'admin';
  const { id } = req.params;

  // Behörighetskontroll (ägare eller admin)
  const isOwner = req.session.user?._id?.toString() === id;
  if (!isAdmin && !isOwner) {
    return res.status(403).json({ error: 'Åtkomst nekad' });
  }

  // Validera kund-ID (ObjectId) och sessionId-format
  const isValidObjectId = require('mongoose').Types.ObjectId.isValid;
  if (!isValidObjectId(String(id))) {
    return res.status(400).json({ error: 'Ogiltigt kund-ID' });
  }

  const { sessionId } = req.query;
  if (typeof sessionId !== "undefined" && !/^[A-Za-z0-9._-]{8,128}$/.test(String(sessionId))) {
    return res.status(400).json({ error: "Ogiltigt sessionId-format" });
  }

  const query = { customerId: id };
  if (sessionId) query.sessionId = sessionId;

  try {
    const messages = await Message.find(query).sort({ timestamp: 1 });
    return res.json(messages.map(m => ({
      message: m.message,
      sender: m.sender,
      timestamp: m.timestamp,
      sessionId: m.sessionId
    })));
  } catch (err) {
    console.error("❌ Kunde inte hämta meddelanden:", err);
    return res.status(500).json({ error: "Fel vid meddelandehämtning" });
  }
});

// 🙋‍♀️ GET /api/chat/me — Returnera kundobjekt
router.get("/me", async (req, res) => {
  const user = req.session?.user;

  if (!user?.email) return res.status(401).json({ error: "Inte inloggad" });

  try {
    const customer = await Customer.findOne({ email: user.email });
    if (!customer) return res.status(404).json({ error: "Kund hittades inte" });

    res.json({
  _id: customer._id,
  name: customer.name,
  email: customer.email,
  profileImage: customer.profileImage
});
  } catch (err) {
    console.error("❌ Fel vid kundhämtning:", err);
    res.status(500).json({ error: "Serverfel vid kundhämtning" });
  }
});

module.exports = router;
