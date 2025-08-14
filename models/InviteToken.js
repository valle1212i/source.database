const mongoose = require("mongoose");

const inviteTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true
  },
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Customer",
    required: true
  },
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  used: {
    type: Boolean,
    default: false
  }
});

module.exports = mongoose.model("InviteToken", inviteTokenSchema);
