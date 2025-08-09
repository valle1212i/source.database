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
    google: platformFormSchema,
    meta: platformFormSchema,
    tiktok: platformFormSchema,
    linkedin: platformFormSchema,
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

  // ✅ LÄGG TILL DETTA
  supportHistory: {
    type: [
      {
        caseId: { type: String, default: "-" },
        date: { type: Date, default: Date.now },
        topic: { type: String, default: "" },
        status: {
          type: String,
          enum: ['Öppen', 'Pågår', 'Stängd'],
          default: 'Öppen'
        }
      }
    ],
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
