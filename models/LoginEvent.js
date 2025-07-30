const mongoose = require("mongoose");

const LoginEventSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Customer",
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  ip: String,
  device: String
});

module.exports = mongoose.model("LoginEvent", LoginEventSchema);
