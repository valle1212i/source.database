const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const Customer = require('./models/Customer');
const cors = require('cors');

dotenv.config();
const app = express();

app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));

// 📂 Gör public-mappen tillgänglig
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(express.json());

// 🔐 Sessioninställningar
app.use(session({
  secret: 'source_secret_key',
  resave: false,
  saveUninitialized: false
}));

// 🌍 Anslut till MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('🟢 Ansluten till MongoDB Atlas'))
  .catch(err => console.error('🔴 Fel vid MongoDB:', err));

// 🔐 Middleware för att skydda sidor
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login.html');
  }
  next();
}

// 🌐 Startsida → Login
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 📝 Registrera ny användare
app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const existingUser = await Customer.findOne({ email });
    if (existingUser) {
      return res.status(400).send('⚠️ E-postadressen är redan registrerad.');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new Customer({ name, email, password: hashedPassword });
    await newUser.save();
    res.redirect('/login.html');
  } catch (err) {
    console.error('❌ Fel vid registrering:', err);
    res.status(500).send('Något gick fel vid registrering.');
  }
});

// 🔑 Logga in användare
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await Customer.findOne({ email });
    if (!user) return res.status(401).send('❌ Fel e-post eller lösenord');

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).send('❌ Fel e-post eller lösenord');

    req.session.user = user;
    res.redirect('/customerportal.html');
  } catch (err) {
    console.error('❌ Fel vid inloggning:', err);
    res.status(500).send('Ett fel uppstod vid inloggning.');
  }
});

// 🔐 Skyddade kundportalsidor
app.get('/customerportal.html', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'customerportal.html'));
});

app.get('/fakturor.html', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'fakturor.html'));
});

app.get('/rapporter.html', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'rapporter.html'));
});

app.get('/inventarier.html', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'inventarier.html'));
});

app.get('/kontakt.html', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'kontakt.html'));
});

app.get('/kunder.html', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'kunder.html'));
});

// 🚪 Logga ut
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login.html');
  });
});

// 🧠 AI-support router
app.use('/api/support', require('./routes/support'));

// 🚀 Starta server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servern körs på http://localhost:${PORT}`);
});

