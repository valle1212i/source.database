// models/Message.js
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },

    // vem som skrev meddelandet
    sender: {
      type: String,
      enum: ['admin', 'customer', 'system'],
      default: 'customer',
      required: true,
    },

    // själva meddelandet
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },

    // valfritt ämne (bra för kontaktformulär)
    subject: {
      type: String,
      default: null,
      trim: true,
      maxlength: 300,
    },

    // valfritt tenant-fält (underlättar multi-tenant queries & indexering)
    tenant: {
      type: String,
      index: true,
      default: null,
      trim: true,
      maxlength: 100,
    },

    // behåll timestamp fältet (ni aggregerar på detta i /latest)
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },

    // sessionId är INTE required för kontaktformulär
    // (chatten kan sätta ett riktigt id; kontaktformulär kan lämna null)
    sessionId: {
      type: String,
      default: null,
      trim: true,
      maxlength: 128,
    },
  },
  {
    // vi använder explicit `timestamp` ovan, så stäng av auto timestamps
    timestamps: false,
    strict: true,
  }
);

// nyttigt index: snabbaste “senaste per kund”
messageSchema.index({ customerId: 1, timestamp: -1 });

module.exports = mongoose.model('Message', messageSchema);
