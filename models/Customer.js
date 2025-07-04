const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,

  // Nya fält
  campaigns: { type: [String], default: [] },
  industry: { type: String, default: 'Ej angivet' },
  website: { type: String, default: '' },
  plan: { type: String, default: 'Gratis' },
  notes: { type: String, default: '' },

  // Automatiska datumfält
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: null },

  // Användarinställningar
  settings: {
  language: { type: String, default: 'sv' },
  theme: { type: String, default: 'light' },
  aiLanguage: { type: String, default: 'sv' } // ← NYTT
}

});

module.exports = mongoose.model('Customer', customerSchema);
