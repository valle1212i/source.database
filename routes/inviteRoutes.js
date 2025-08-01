const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const InviteToken = require("../models/InviteToken");
const Customer = require("../models/Customer");
const nodemailer = require("nodemailer");

router.post("/send", async (req, res) => {
  const { name, email } = req.body;
  const admin = req.session?.user;

  if (!admin || admin.role !== "admin") {
    return res.status(403).json({ success: false, message: "Endast admin kan bjuda in användare." });
  }

  if (!name || !email) {
    return res.status(400).json({ success: false, message: "Namn och e-post krävs." });
  }

  try {
    // 🔑 Skapa token
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h giltighet

    await InviteToken.create({
      token,
      email,
      name,
      invitedBy: admin._id,
      groupId: admin.groupId, // eller annat fält du använder för tillhörighet
      expiresAt
    });

    // 📤 Skicka mejl
    const registerLink = `https://din-domän.se/register.html?token=${token}`;

    const transporter = nodemailer.createTransport({
      service: "gmail", // eller annat
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: `"Kundportal" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Du har blivit inbjuden till Kundportalen",
      html: `
        <p>Hej ${name},</p>
        <p>Du har blivit inbjuden att gå med i kundportalen.</p>
        <p>Klicka på länken nedan för att registrera ett konto:</p>
        <p><a href="${registerLink}">${registerLink}</a></p>
        <p>Länken är giltig i 24 timmar.</p>
      `
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Fel vid utskick:", err);
    res.status(500).json({ success: false, message: "Serverfel vid inbjudan." });
  }
});

router.get("/verify", async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ success: false, message: "Token saknas." });
  }

  try {
    const invite = await InviteToken.findOne({ token });

    if (!invite) {
      return res.status(404).json({ success: false, message: "Ogiltig inbjudan." });
    }

    if (invite.expiresAt < new Date()) {
      return res.status(410).json({ success: false, message: "Inbjudan har gått ut." });
    }

    if (invite.used) {
      return res.status(409).json({ success: false, message: "Denna inbjudan har redan använts." });
    }

    res.json({
      success: true,
      name: invite.name,
      email: invite.email
    });
  } catch (err) {
    console.error("❌ Fel vid verifiering:", err);
    res.status(500).json({ success: false, message: "Serverfel." });
  }
});

const bcrypt = require("bcrypt");

router.post("/complete", async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ success: false, message: "Token och lösenord krävs." });
  }

  try {
    const invite = await InviteToken.findOne({ token });

    if (!invite) {
      return res.status(404).json({ success: false, message: "Ogiltig inbjudan." });
    }

    if (invite.expiresAt < new Date()) {
      return res.status(410).json({ success: false, message: "Inbjudan har gått ut." });
    }

    if (invite.used) {
      return res.status(409).json({ success: false, message: "Inbjudan har redan använts." });
    }

    // Kolla om e-post redan finns
    const existing = await Customer.findOne({ email: invite.email });
    if (existing) {
      return res.status(409).json({ success: false, message: "E-postadressen är redan registrerad." });
    }

    // Skapa användare
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await Customer.create({
      name: invite.name,
      email: invite.email,
      password: hashedPassword,
      role: "user",
      groupId: invite.groupId
    });

    // Logga in användaren direkt
req.session.user = {
  _id: newUser._id,
  name: newUser.name,
  email: newUser.email,
  role: newUser.role,
  groupId: newUser.groupId,
  profileImage: newUser.profileImage || null,
  settings: newUser.settings || {}
};

    // Markera inbjudan som använd
    invite.used = true;
    await invite.save();

    res.json({ success: true, message: "Användare skapad." });
  } catch (err) {
    console.error("❌ Fel vid slutförande av inbjudan:", err);
    res.status(500).json({ success: false, message: "Serverfel." });
  }
});

router.get("/users", async (req, res) => {
  const admin = req.session?.user;

    console.log("🔍 Admins session groupId:", admin?.groupId);

  if (!admin || admin.role !== "admin") {
    return res.status(403).json({ success: false, message: "Endast admin kan se användare." });
  }

  try {
    const users = await Customer.find({ groupId: admin.groupId }).select("name email role");
    res.json({ success: true, users });
  } catch (err) {
    console.error("❌ Fel vid hämtning av användare:", err);
    res.status(500).json({ success: false, message: "Serverfel." });
  }
});

module.exports = router;
