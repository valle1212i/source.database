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

  // ✅ MARKNADSFÖRING
  marketing: {
    googleAds: {
      selected: { type: Boolean, default: false },
      budget: { type: String, default: '' },
      goals: { type: String, default: '' }
    },
    metaAds: {
      selected: { type: Boolean, default: false },
      budget: { type: String, default: '' },
      goals: { type: String, default: '' }
    },
    tiktokAds: {
      selected: { type: Boolean, default: false },
      budget: { type: String, default: '' },
      goals: { type: String, default: '' }
    },
    linkedinAds: {
      selected: { type: Boolean, default: false },
      budget: { type: String, default: '' },
      goals: { type: String, default: '' }
    },
    otherNotes: { type: String, default: '' }
  },

  role: {
    type: String,
    enum: ['admin', 'user'],
    default: 'user'
  },

  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },

  // Automatiska datumfält
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: null },

  // Användarinställningar
  settings: {
    language: { type: String, default: 'sv' },
    theme: { type: String, default: 'light' },
    aiLanguage: { type: String, default: 'sv' }
  },

  // 🔄 Profilbild (NYTT)
  profileImage: {
    type: String,
    default: null
  }
});

module.exports = mongoose.model('Customer', customerSchema);
