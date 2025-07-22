const mongoose = require('mongoose');
 
const messageSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  sender: {
    type: String,
    enum: ['admin', 'customer'],
    required: true
  },
  message: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  sessionId: { // 🆕 Lägg till detta
    type: String,
    required: true
  }
});
 
module.exports = mongoose.model('Message', messageSchema);
