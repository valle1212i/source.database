const mongoose = require('mongoose');

const LineItemSchema = new mongoose.Schema({
  price_id: String,
  quantity: Number,
  amount_subtotal: Number,
  amount_total: Number,
  description: String,
  product: String,
  currency: String
}, { _id: false });

const PaymentSchema = new mongoose.Schema({
  sessionId:     { type: String, index: true, unique: true },
  payment_intent_id: String,

  amount_total:  Number,   // i öre/cent
  currency:      String,   // "sek" etc
  status:        String,   // "paid", "open", "expired" ...

  customer_email: { type: String, index: true },
  customer_name:  String,

  line_items:    [LineItemSchema],

  // Nytt: metadata från checkout
  metadata:      { type: Object, default: {} },

  // Tidsstämplar
  stripe_created: { type: Date, index: true },
  createdAt:      { type: Date, default: Date.now }
}, { collection: 'payments' });

module.exports = mongoose.model('Payment', PaymentSchema);
