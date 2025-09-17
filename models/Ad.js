const mongoose = require('mongoose');

const adSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  platform: { type: String, enum: ['google', 'meta', 'linkedin', 'tiktok'], required: true },
  
  // Frågesvar – trim + rimliga längdgränser (matchar valideringen i routern)
  q1: { type: String, trim: true, maxlength: 500 },
  q2: { type: String, trim: true, maxlength: 500 },
  q3: { type: String, trim: true, maxlength: 500 },
  q4: { type: String, trim: true, maxlength: 500 },
  q5: { type: String, trim: true, maxlength: 500 },
  q6: { type: String, trim: true, maxlength: 500 },
  q7: { type: String, trim: true, maxlength: 500 },

  extraInfo: { type: String, trim: true, maxlength: 1000 }, // valfritt fält för övrigt
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Ad', adSchema);
