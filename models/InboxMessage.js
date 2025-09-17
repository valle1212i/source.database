const mongoose = require('mongoose');

const inboxMessageSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  tenant: { type: String, trim: true, index: true },
  subject: { type: String, default: 'Kontaktformulär' },
  message: { type: String, required: true },
  sender:  { type: String, enum: ['customer','staff','system'], default: 'customer' },
  timestamp: { type: Date, default: Date.now },
}, { timestamps: true });

inboxMessageSchema.index({ tenant: 1, customerId: 1, timestamp: -1 });

module.exports = mongoose.model('InboxMessage', inboxMessageSchema);
