// models/Customer.js
const mongoose = require('mongoose');

// Separat sub-schema för formulärsvar per plattform
const platformFormSchema = new mongoose.Schema({
  q1: String, q2: String, q3: String, q4: String, q5: String, q6: String, q7: String
}, { _id: false });

// Hjälpfunktion: enkel domänvalidering (ex: foo.se, www.foo.se, shop.foo.co.uk)
const DOMAIN_REGEX = /^([a-z0-9-]+\.)+[a-z]{2,}$/i;

const customerSchema = new mongoose.Schema({
  name: { type: String, trim: true },

  // Viktigt: ingen global unique här – vi använder composite index längre ner
  email: { type: String, required: true, trim: true, lowercase: true },

  // Nyckel för multi-tenant
  tenant: { type: String, trim: true, index: true }, // inte required => adminkonton kan sakna

  // Lösenord krävs bara för admin/user (inte för publika leads med roll "customer")
  password: {
    type: String,
    required: function () { return this.role !== 'customer'; }
  },

  // Nya fält (behålls)
  campaigns: { type: [String], default: [], maxlength: 50 },
  industry: { type: String, trim: true, maxlength: 200, default: 'Ej angivet' },

  // Valfri webb-URL (fri text, används inte för filtrering)
  website: { type: String, trim: true, maxlength: 500, default: '' },

  // 🔹 NYTT: primär domän (endast hostname, t.ex. "vattentrygg.se")
  domain: {
    type: String,
    trim: true,
    maxlength: 200,
    default: '',
    set: v => (typeof v === 'string' ? v.replace(/^https?:\/\//i, '').replace(/^www\./i, '').trim().toLowerCase() : v),
    validate: {
      validator: v => !v || DOMAIN_REGEX.test(v),
      message: 'Ogiltig domän'
    }
  },

  // 🔹 NYTT: alternativa domäner/subdomäner
  domains: {
    type: [String],
    default: [],
    set: arr => Array.isArray(arr)
      ? arr.map(s => String(s).replace(/^https?:\/\//i, '').replace(/^www\./i, '').trim().toLowerCase()).filter(Boolean)
      : [],
    validate: {
      validator: arr => Array.isArray(arr) && arr.length <= 50 && arr.every(d => DOMAIN_REGEX.test(d)),
      message: 'En eller flera domäner i "domains" är ogiltiga'
    }
  },

  plan: { type: String, trim: true, maxlength: 100, default: 'Gratis' },
  notes: { type: String, trim: true, maxlength: 2000, default: '' },

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
    otherNotes: { type: String, trim: true, maxlength: 2000, default: '' }
  },

  // ✅ SUPPORTHISTORIK
  supportHistory: {
    type: [{
      caseId: { type: String, default: "-" },
      date:   { type: Date,   default: Date.now },
      topic:  { type: String, default: "" },
      status: { type: String, enum: ['Öppen', 'Pågår', 'Stängd'], default: 'Öppen' }
    }],
    default: []
  },

  // Tillåt även 'customer' för publika leads
  role: {
    type: String,
    enum: ['admin', 'user', 'customer'],
    default: 'user'
  },

  // Krävs för admin/user, inte för customer (publika leads)
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    required: function () { return this.role !== 'customer'; }
  },

  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: null },

  settings: {
    language:   { type: String, default: 'sv' },
    theme:      { type: String, default: 'light' },
    aiLanguage: { type: String, default: 'sv' }
  },

  profileImage: {
    type: String,
    trim: true,
    maxlength: 500,
    default: null
  }
}, { timestamps: true });

// 🔐 Behåll ditt befintliga index (en admin per groupId)
customerSchema.index(
  { groupId: 1, role: 1 },
  { unique: true, partialFilterExpression: { role: 'admin' } }
);

// ✅ Nytt: unikt komposit-index per (email, tenant)
//   Gör att samma e-post kan finnas i flera tenants, men inte dubbelt inom samma tenant
customerSchema.index({ email: 1, tenant: 1 }, { unique: true });

module.exports = mongoose.model('Customer', customerSchema);
