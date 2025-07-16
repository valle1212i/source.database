const imaps = require("imap-simple");
const { simpleParser } = require("mailparser");
const Message = require("../models/Message");

require("dotenv").config();

const config = {
  imap: {
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASSWORD,
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT),
    tls: process.env.IMAP_TLS === 'true',
    authTimeout: 10000
  }
};



// 📨 Sparar meddelanden i databasen
async function fetchEmailsAndSave() {
  const connection = await imaps.connect({ imap: config.imap });
  try {
    await connection.openBox("INBOX");

    const searchCriteria = ["UNSEEN"];
    const fetchOptions = { bodies: ["HEADER", "TEXT"], markSeen: true };

    const results = await connection.search(searchCriteria, fetchOptions);

    for (let res of results) {
      if (!res.parts) continue;
      const all = res.parts.find(part => part.which === "TEXT");
      if (!all) continue;

      const parsed = await simpleParser(all.body);

      const message = new Message({
        customerId: process.env.IMAP_CUSTOMER_ID,
        sender: parsed.from.text,
        message: parsed.text,
        timestamp: parsed.date instanceof Date ? parsed.date : new Date()
      });

      await message.save();
      console.log(`📥 Sparat e-post från ${parsed.from.text}`);
    }
  } finally {
    connection.end(); // ← körs alltid, även vid fel
  }
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
