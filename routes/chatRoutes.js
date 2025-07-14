const express = require('express');
const router = express.Router();
require('dotenv').config();

const { CohereClient } = require('cohere-ai');
const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

const { franc } = await import("franc");
const langs = require('langs');     // Konverterar språk-kod till namn

const Customer = require('../models/Customer');
const Message = require('../models/Message'); // 📦 Viktig för meddelanden

// 🔁 AI-endpoint: /api/chat/ask
router.post('/ask', async (req, res) => {
  const { message } = req.body;
  const sessionUser = req.session.user;

  if (!sessionUser || !sessionUser.email) {
    return res.status(401).json({ reply: '❌ Du är inte inloggad.' });
  }

  try {
    const customer = await Customer.findOne({ email: sessionUser.email });
    if (!customer) {
      return res.status(404).json({ reply: '❌ Kunde inte hitta kunddata.' });
    }

    const langCode = franc(message);
    let detectedLanguage = 'sv'; // fallback
    if (langCode !== 'und') {
      const lang = langs.where('3', langCode);
      if (lang) detectedLanguage = lang.name.toLowerCase();
    }

    const systemPrompt = `
Du är en hjälpsam, tillmötesgående och vänlig AI-supportagent i en kundportal. Du svarar kortfattat men trevligt – på ett sätt som känns mänskligt och professionellt.

Användaren kan skriva på vilket språk som helst – svara alltid på **samma språk** som frågan.

Språket för detta samtal är: ${detectedLanguage.toUpperCase()}.

Användarens information:
- Namn: ${customer.name}
- E-post: ${customer.email}
- Kampanjer: ${customer.campaigns?.join(', ') || 'Ingen information'}
- Bransch: ${customer.industry || 'Ej angivet'}
- Webbplats: ${customer.website || 'Ej angiven'}
- Skapad: ${customer.createdAt?.toISOString().split('T')[0] || 'Okänt'}
- Senast inloggad: ${customer.lastLogin?.toISOString().split('T')[0] || 'Okänt'}
- Plan: ${customer.plan || 'Gratis'}
- Anteckningar: ${customer.notes || 'Inga'}
`;

    const response = await cohere.chat({
      model: 'command-r-plus',
      message,
      chatHistory: [],
      promptTruncation: 'AUTO',
      connectors: [],
      temperature: 0.7,
      p: 0.75,
      k: 0,
      stopSequences: [],
      returnLikelihoods: 'NONE',
      preamble: systemPrompt
    });

    res.json({ reply: response.text || '⚠️ Inget svar från AI.' });

  } catch (err) {
    console.error('❌ Fel vid AI-anrop:', err);
    res.status(500).json({ reply: '❌ Ett fel uppstod vid kontakt med AI.' });
  }
});

// 📨 Hämta meddelanden för en viss kund: GET /api/chat/customer/:id
router.get('/customer/:id', async (req, res) => {
  try {
    const customerId = req.params.id;
    const messages = await Message.find({ customerId }).sort({ timestamp: 1 });

    res.json(messages); // ✅ Returnerar JSON till frontend
  } catch (err) {
    console.error('❌ Kunde inte hämta meddelanden:', err);
    res.status(500).json({ error: 'Kunde inte hämta meddelanden' });
  }
});

module.exports = router;
