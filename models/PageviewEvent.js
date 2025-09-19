const mongoose = require('mongoose');

const PageviewEventSchema = new mongoose.Schema({
  site: { type: String, index: true },     // t.ex. 'vattentrygg.se'
  url: { type: String, index: true },
  referrer: { type: String, index: true },
  title: String,
  ts: { type: Date, index: true },         // exakt timestamp
  ua: String,                               // user-agent (rå, ej nödvändig att hashas)
  ip_hash: { type: String, index: true },   // sha256(ip + IP_SALT)
  ua_hash: { type: String, index: true },   // sha256(ua + IP_SALT)
  day: { type: String, index: true },       // YYYY-MM-DD (UTC, för snabba per-dag-queries)
  consent: { type: Boolean, default: false },

  // Geo (ingen rå IP sparas)
  country: { type: String, index: true },   // ISO-2, t.ex. 'SE'
  region: String,                           // t.ex. 'AB' eller regionnamn
  city: String,
  continent: { type: String, index: true }  // t.ex. 'EU', 'NA', ...
}, {
  versionKey: false,
  timestamps: false
});

module.exports = mongoose.model('PageviewEvent', PageviewEventSchema);
