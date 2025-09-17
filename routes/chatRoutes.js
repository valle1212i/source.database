const express = require("express");
const dotenv = require("dotenv");
const OpenAI = require("openai");
const Customer = require("../models/Customer");
const Message = require("../models/Message");
const requireAuth = require('../middleware/requireAuth');
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const mongoose = require("mongoose");
const { ipKeyGenerator } = require("express-rate-limit");


// Enkel sanering: ta bort HTML-taggar + normalisera whitespace
const sanitize = (s) =>
  typeof s === "string" ? s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() : "";

// Zod-schema för chatpayload
const ChatMessageSchema = z.object({
  message: z
    .string()
    .min(1, "message måste vara 1–2000 tecken")
    .max(2000, "message måste vara 1–2000 tecken")
    .transform(sanitize),
  sessionId: z
    .string()
    .regex(/^[A-Za-z0-9._-]{8,128}$/, "ogiltigt sessionId-format"),
  sender: z.enum(["admin", "customer", "system"]).optional(),
  customerId: z
    .string()
    .optional()
    .refine((v) => !v || mongoose.Types.ObjectId.isValid(v), {
      message: "ogiltigt customerId",
    }),
});

// Zod-schema för AI-fråga (/ask)
const ChatAskSchema = z.object({
  message: z
    .string()
    .min(1, "message måste vara 1–1500 tecken")
    .max(1500, "message måste vara 1–1500 tecken")
    .transform(sanitize),
});

const askLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minut
  max: 12,             // max 12 anrop/min per användare/IP
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) =>
    req.session?.user?._id?.toString() || ipKeyGenerator(req)
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minut
  max: 30,             // max 30 meddelanden/min per användare/IP
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.session?.user?._id?.toString() || ipKeyGenerator(req)
});


dotenv.config();
const router = express.Router();

// 🔑 OpenAI setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


// 🧠 POST /api/chat/ask — AI-fråga
router.post("/ask", askLimiter, async (req, res) => {

  const sessionUser = req.session?.user;

  if (!sessionUser?.email) return res.status(401).json({ reply: "❌ Du är inte inloggad." });

  try {
    const customer = await Customer.findOne({ email: sessionUser.email });
    if (!customer) return res.status(404).json({ reply: "❌ Kunde inte hitta kunddata." });

// Zod-parse (sanering via .transform i ChatAskSchema)
const parsedAsk = ChatAskSchema.safeParse(req.body);
if (!parsedAsk.success) {
  return res.status(400).json({
    reply: "❌ Ogiltigt meddelande.",
    details: parsedAsk.error.issues.map(i => i.message)
  });
}
const message = parsedAsk.data.message;

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


router.post("/", requireAuth, chatLimiter, async (req, res) => {
  const user = req.session.user;
  const isAdmin = user?.role === "admin";

  // Zod-parse (sanering sker via .transform i ChatMessageSchema)
  const parsed = ChatMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Ogiltig data",
      details: parsed.error.issues.map(i => i.message)
    });
  }
  const data = parsed.data;

  // Tvinga/derivera fält baserat på roll
  const sender = isAdmin ? (data.sender || "admin") : "customer";
  const finalCustomerId = isAdmin ? (data.customerId || user._id) : user._id;

  if (!finalCustomerId) {
    return res.status(400).json({ error: "Ogiltig data", details: ["saknar customerId (session)"] });
  }

  try {
    const doc = await Message.create({
      customerId: finalCustomerId,
      message: data.message,     // redan sanerad av schema.transform(sanitize)
      sender,
      timestamp: new Date(),
      sessionId: data.sessionId
    });

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
  if (!user?._id) return res.status(401).json({ error: "Inte inloggad" });

  // Zod-parse av query (optional sessionId)
  const QueryMeSchema = z.object({
    sessionId: z.string().regex(/^[A-Za-z0-9._-]{8,128}$/, "Ogiltigt sessionId-format").optional()
  });

  const parsed = QueryMeSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Ogiltig query",
      details: parsed.error.issues.map(i => i.message)
    });
  }

  const query = { customerId: user._id };
  if (parsed.data.sessionId) query.sessionId = parsed.data.sessionId;

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
  const user = req.session.user;
  const isAdmin = user?.role === 'admin';

  // Zod-scheman för params och query
  const ParamsSchema = z.object({
    id: z.string().refine(v => mongoose.Types.ObjectId.isValid(v), "Ogiltigt kund-ID"),
  });
  const QuerySchema = z.object({
    sessionId: z.string().regex(/^[A-Za-z0-9._-]{8,128}$/, "Ogiltigt sessionId-format").optional(),
  });

  const paramsParsed = ParamsSchema.safeParse(req.params);
  const queryParsed = QuerySchema.safeParse(req.query);
  const issues = [];
  if (!paramsParsed.success) issues.push(...paramsParsed.error.issues.map(i => i.message));
  if (!queryParsed.success) issues.push(...queryParsed.error.issues.map(i => i.message));
  if (issues.length) {
    return res.status(400).json({ error: "Ogiltig request", details: issues });
  }

  const { id } = paramsParsed.data;
  const isOwner = user?._id?.toString() === id;
  if (!isAdmin && !isOwner) {
    return res.status(403).json({ error: 'Åtkomst nekad' });
  }

  const query = { customerId: id };
  if (queryParsed.data.sessionId) query.sessionId = queryParsed.data.sessionId;

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
