const express = require('express');
const router = express.Router();
require('dotenv').config();

const { CohereClient } = require('cohere-ai');
const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

const { franc } = require('franc'); // Språkdetektering
const langs = require('langs'); // För att konvertera språk-kod till namn

const Customer = require('../models/Customer');

// AI-endpoint: /api/support/ask
router.post('/ask', async (req, res) => {
  const { message } = req.body;
  const sessionUser = req.session.user;

  if (!sessionUser || !sessionUser.email) {
    return res.status(401).json({ reply: '❌ Du är inte inloggad.' });
  }

  try {
    // Hämta kunddata från databasen
    const customer = await Customer.findOne({ email: sessionUser.email });

    if (!customer) {
      return res.status(404).json({ reply: '❌ Kunde inte hitta kunddata.' });
    }

    // 🧠 Detektera vilket språk användaren skriver på
    const langCode = franc(message); // t.ex. 'spa', 'eng', etc.
    let detectedLanguage = 'sv'; // fallback

    if (langCode !== 'und') {
      const lang = langs.where('3', langCode);
      if (lang) {
        detectedLanguage = lang.name.toLowerCase(); // t.ex. 'spanish', 'english'
      }
    }

    // 📝 Systemprompt med användarinfo och språk
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
- Skapad: ${customer.createdAt ? customer.createdAt.toISOString().split('T')[0] : 'Okänt'}
- Senast inloggad: ${customer.lastLogin ? customer.lastLogin.toISOString().split('T')[0] : 'Okänt'}
- Plan: ${customer.plan || 'Gratis'}
- Anteckningar: ${customer.notes || 'Inga'}

Svara på ett varmt, respektfullt sätt, även om frågan är enkel.
Exempel: om användaren frågar om sin webbplats, skriv gärna något i stil med "Självklart! Här är länken till din webbplats:" följt av URL:en.
`;


    // 🔁 Anropa Cohere AI
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

module.exports = router;
