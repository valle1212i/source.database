// models/Invite.js
const mongoose = require('mongoose');

const inviteSchema = new mongoose.Schema({
  // Vem som bjuds in
  email: { type: String, required: true, lowercase: true, trim: true },

  // Vilken roll gästen ska få när länken löses in
  role: { type: String, enum: ['admin', 'user'], required: true, default: 'user' },

  // Företagskoppling: sätts för vanliga inbjudningar.
  // För FÖRSTA admin kan denna vara null (ny grupp skapas då vid redeem).
  groupId: { type: mongoose.Schema.Types.ObjectId, default: null },

  // Säker tokenhantering: vi lagrar ENDAST hash av token (inte klartext).
  tokenHash: { type: String, required: true, unique: true },

  // Giltighet och användningar
  expiresAt: { type: Date, required: true },
  maxUses: { type: Number, default: 1, min: 1 },
  usedCount: { type: Number, default: 0 },

  // Metadata
  isFirstAdmin: { type: Boolean, default: false }, // true om detta är första admin i företaget
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
  createdAt: { type: Date, default: Date.now }
});

// TTL-index: dokument tas bort automatiskt efter expiresAt
inviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Invite', inviteSchema);
