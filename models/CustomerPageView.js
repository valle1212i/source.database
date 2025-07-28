const mongoose = require("mongoose");

const customerPageViewSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Customer",
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  views: {
    type: Number,
    default: 1,
  }
});

// Säkerställ att varje kund endast har ett entry per dag
customerPageViewSchema.index({ customerId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("CustomerPageView", customerPageViewSchema);
