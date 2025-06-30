const express = require('express');
const router = express.Router();
require('dotenv').config();

const { CohereClient } = require('cohere-ai');
const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

const Customer = require('../models/Customer');

// AI-endpoint: /api/support/ask
router.post('/ask', async (req, res) => {
  const { message } = req.body;
  const sessionUser = req.session.user;

  if (!sessionUser || !sessionUser.email) {
    return res.status(401).json({ reply: '❌ Du är inte inloggad.' });
  }

  try {
    // Hämta fullständig användardata från databasen
    const customer = await Customer.findOne({ email: sessionUser.email });

    if (!customer) {
      return res.status(404).json({ reply: '❌ Kunde inte hitta kunddata.' });
    }

    // Skapa systemprompt med användardata
    const systemPrompt = `
      Du är en AI-supportagent för vår kundportal. Användarens information:
      - Namn: ${customer.name}
      - E-post: ${customer.email}  
      - Kampanjer: ${customer.campaigns?.join(', ') || 'Ingen information'} 
      - Bransch: ${customer.industry || 'Ej angivet'}
      - Webbplats: ${customer.website || 'Ej angiven'}
      - Skapad: ${customer.createdAt ? customer.createdAt.toISOString().split('T')[0] : 'Okänt'}
      - Senast inloggad: ${customer.lastLogin ? customer.lastLogin.toISOString().split('T')[0] : 'Okänt'}
      - Plan: ${customer.plan || 'Gratis'}
      - Anteckningar: ${customer.notes || 'Inga'}


      Besvara frågan på ett sätt som är relevant för just denna kund.
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

module.exports = router;
