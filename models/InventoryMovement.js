// models/InventoryMovement.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Auditlogg för lagerändringar (+1 retur, -1 köp, eller manuellt).
 * stripeEventId används för idempotens när Stripe-webhooken är igång.
 */
const InventoryMovementSchema = new Schema({
  tenant: { type: String, required: true, index: true },
  itemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, index: true },
  variantSku: { type: String, trim: true },
  delta: { type: Number, required: true, enum: [-1, 1] },
  reason: { type: String, required: true }, // "purchase" | "return" | "manual"
  stripeEventId: { type: String, index: true },
  meta: { type: Schema.Types.Mixed }
}, { timestamps: true });

InventoryMovementSchema.index({ tenant: 1, stripeEventId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('InventoryMovement', InventoryMovementSchema);
