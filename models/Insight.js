const mongoose = require('mongoose');

const insightSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  title: { type: String, required: true },
  category: {
    type: String,
    enum: ['Annonsering', 'Konvertering', 'Strategi', 'Engagemang'],
    required: true
  },
  reason: { type: String, required: true },
  action: { type: String, required: true },
  priority: { type: Boolean, default: false },
  generatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Insight', insightSchema);
