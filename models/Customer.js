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
    platforms: [String],             // Från övergripande formulär (dropdowns)
    goals: String,                   // Från övergripande formulär
    comment: String,                 // Från övergripande formulär
    updatedAt: Date,                 // Datum då något sparades

    // ✅ Detaljerade svar från stegvisa formulär
    google: platformFormSchema,
    meta: platformFormSchema,
    tiktok: platformFormSchema,
    linkedin: platformFormSchema,

    // Fortsätt stödja gamla strukturen om ni redan använt den
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

module.exports = mongoose.model('Customer', customerSchema);
