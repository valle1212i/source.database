// models/Customer.js
const mongoose = require('mongoose');

// Separat sub-schema för formulärsvar per plattform
const platformFormSchema = new mongoose.Schema({
  q1: String,
  q2: String,
  q3: String,
  q4: String,
  q5: String,
  q6: String,
  q7: String
}, { _id: false });

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
    platforms: [String],
    goals: String,
    comment: String,
    updatedAt: Date,

    // Detaljerade svar
    google: platformFormSchema,
    meta: platformFormSchema,
    tiktok: platformFormSchema,
    linkedin: platformFormSchema,

    // Bakåtkompabilitet
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

  // ✅ SUPPORTHISTORIK
  supportHistory: {
    type: [{
      caseId: { type: String, default: "-" },
      date: { type: Date, default: Date.now },
      topic: { type: String, default: "" },
      status: {
        type: String,
        enum: ['Öppen', 'Pågår', 'Stängd'],
        default: 'Öppen'
      }
    }],
    default: []
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

  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: null },

  settings: {
    language: { type: String, default: 'sv' },
    theme: { type: String, default: 'light' },
    aiLanguage: { type: String, default: 'sv' }
  },

  profileImage: {
    type: String,
    default: null
  }
});

customerSchema.index({ groupId: 1, role: 1 }, { unique: true, partialFilterExpression: { role: 'admin' } });

module.exports = mongoose.model('Customer', customerSchema);
