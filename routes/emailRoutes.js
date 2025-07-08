const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');

// POST /api/email/send
router.post('/send', async (req, res) => {
  const { to, subject, message } = req.body;

  if (!to || !subject || !message) {
    return res.status(400).json({ success: false, msg: 'Ogiltiga fält.' });
  }

  try {
    // 📤 Skapa transport med e-postkonto
    const transporter = nodemailer.createTransport({
      service: 'gmail', // byt till t.ex. 'hotmail' eller använd en SMTP-server om du vill
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    // 📧 Skicka meddelandet
    await transporter.sendMail({
      from: `"Support – Kundportal" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text: message
    });

    console.log(`✅ E-post skickat till ${to}`);
    res.json({ success: true, msg: 'E-post skickat.' });
  } catch (err) {
    console.error('❌ Fel vid e-post:', err);
    res.status(500).json({ success: false, msg: 'Kunde inte skicka e-post.' });
  }
});

module.exports = router;
