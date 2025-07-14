const imaps = require("imap-simple");
const { simpleParser } = require("mailparser");
const Message = require("../models/Message");

require("dotenv").config();

const config = {
  imap: {
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASSWORD,
    host: process.env.IMAP_HOST,
    port: 993,
    tls: true,
    authTimeout: 3000
  }
};

// 📨 Sparar meddelanden i databasen
async function fetchEmailsAndSave() {
  const connection = await imaps.connect({ imap: config.imap });
  await connection.openBox("INBOX");

  const searchCriteria = ["UNSEEN"]; // bara olästa
  const fetchOptions = { bodies: ["HEADER", "TEXT"], markSeen: true };

  const results = await connection.search(searchCriteria, fetchOptions);

  for (let res of results) {
    const all = res.parts.find(part => part.which === "TEXT");
    const parsed = await simpleParser(all.body);

    const message = new Message({
      customerId: process.env.IMAP_CUSTOMER_ID, // tillfälligt kopplat
      sender: parsed.from.text,
      message: parsed.text,
      timestamp: parsed.date || new Date()
    });

    await message.save();
    console.log(`📥 Sparat e-post från ${parsed.from.text}`);
  }

  connection.end();
}

// 📨 Returnerar meddelanden (för att visa i frontend)
async function fetchEmails() {
  const messages = await Message.find({ customerId: process.env.IMAP_CUSTOMER_ID })
    .sort({ timestamp: -1 })
    .limit(50);

  return messages;
}

module.exports = {
  fetchEmailsAndSave,
  fetchEmails
};
