const mongoose = require('mongoose');

const adSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  platform: { type: String, enum: ['google', 'meta', 'linkedin', 'tiktok'], required: true },
  
  // Frågesvar – anpassa fälten efter behov
  q1: String,
  q2: String,
  q3: String,
  q4: String,
  q5: String,
  q6: String,
  q7: String,

  extraInfo: String, // valfritt fält för övrigt
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Ad', adSchema);
