// models/InventoryItem.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const VariantSchema = new Schema({
  key: { type: String, trim: true },            // t.ex. "S", "M", "L" eller "43"
  sku: { type: String, trim: true, index: true },
  stock: { type: Number, default: 0, min: 0 }
}, { _id: false });

const InventoryItemSchema = new Schema({
  tenant: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  sku: { type: String, trim: true, index: true }, // används om inga varianter
  description: { type: String, trim: true },
  imageUrl: { type: String, trim: true },
  stock: { type: Number, default: 0, min: 0 },    // används om variants.length === 0
  variants: { type: [VariantSchema], default: [] },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

InventoryItemSchema.index({ tenant: 1, sku: 1 }, { unique: false, sparse: true });
InventoryItemSchema.index({ tenant: 1, 'variants.sku': 1 }, { unique: false, sparse: true });

module.exports = mongoose.model('InventoryItem', InventoryItemSchema);
