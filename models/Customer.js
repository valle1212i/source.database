const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true }, // Säkerställer unika användare
  password: String,
  settings: {
    language: { type: String, default: 'sv' },
    theme: { type: String, default: 'light' },
    // Lägg till fler inställningar här om du vill
  }
});

module.exports = mongoose.model('Customer', customerSchema);
