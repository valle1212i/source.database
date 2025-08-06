const express = require('express');
const router = express.Router();
const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const Customer = require('../models/Customer');

// GET /api/insights/:customerId
router.get('/:customerId', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.customerId).lean();
    if (!customer) return res.status(404).json({ error: 'Kund ej hittad' });

    const messages = [
      {
        role: "system",
        content: `
Du är en expert inom e-handelstillväxt och digital marknadsföring.
Ditt uppdrag är att generera konkreta, mätbara och personliga tillväxttips
baserat på en kunds faktiska användarbeteende och marknadsföringsdata.

Svara alltid i JSON-format enligt strukturen:
[
  {
    "title": "...",
    "category": "Annonsering | Konvertering | Strategi | Engagemang",
    "reason": "...",
    "action": "...",
    "priority": true/false
  }
]
Tipsen ska vara:
- Baserade på deras kanalval, mål, kampanjaktivitet och plan
- Kopplade till säsong, bransch eller inaktivitet
- Konkreta (ex: "Skapa en kampanj på Meta med X", inte "förbättra marknadsföring")
        `
      },
      {
        role: "user",
        content: `Här är kundens data i JSON-format:\n\n${JSON.stringify(customer)}`
      }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages,
      temperature: 0.7
    });

    const insightsRaw = completion.choices[0].message.content;

    let insights;
    try {
      insights = JSON.parse(insightsRaw);
    } catch (err) {
      console.warn("⚠️ Kunde inte tolka AI-svar som JSON:", insightsRaw);
      return res.status(500).json({ error: "Ogiltigt AI-svar", raw: insightsRaw });
    }

    res.json({ insights });

  } catch (err) {
    console.error("❌ Fel i AI-insights:", err);
    res.status(500).json({ error: "Serverfel vid AI-generering" });
  }
});

module.exports = router;
