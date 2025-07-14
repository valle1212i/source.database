const express = require("express");
const router = express.Router();
const { fetchEmailsAndSave, fetchEmails } = require("../utils/fetchEmails");

router.get("/sync", async (req, res) => {
  await fetchEmailsAndSave();
  res.send("✅ Synk klar");
});

router.get("/inbox", async (req, res) => {
  const emails = await fetchEmails();
  res.json(emails);
});

module.exports = router;
