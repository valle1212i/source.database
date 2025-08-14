const express = require("express");
const router = express.Router();
const Invite = require("../models/Invite");
const crypto = require("crypto");
const Customer = require("../models/Customer");
const mongoose = require('mongoose'); // behövs för att förskapa _id
const bcrypt = require("bcrypt");


router.post("/complete", async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ success: false, message: "Token och lösenord krävs." });
  }

  try {
    const now = new Date();

    // Verifiera invite via HASHAD token
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const invite = await Invite.findOne({ tokenHash });

    if (!invite) {
      return res.status(404).json({ success: false, message: "Ogiltig inbjudan." });
    }
    if (invite.expiresAt <= now) {
      return res.status(410).json({ success: false, message: "Inbjudan har gått ut." });
    }
    if (invite.usedCount >= invite.maxUses) {
      return res.status(409).json({ success: false, message: "Denna inbjudan har redan använts." });
    }

    // Denna route hanterar ENDAST vanliga invites till befintligt företag.
    // Första-admin (ingen groupId ELLER isFirstAdmin=true) tar vi i nästa steg.
    if (!invite.groupId || invite.isFirstAdmin) {
      return res.status(400).json({
        success: false,
        message: "Denna länk är för första admin och kräver ett separat flöde (aktiveras i nästa steg)."
      });
    }

    // Blockera om e-post redan finns
    const existing = await Customer.findOne({ email: invite.email });
    if (existing) {
      return res.status(409).json({ success: false, message: "E-postadressen är redan registrerad." });
    }

    // Extra skydd: om invite.role skulle vara 'admin' – tillåt bara om ingen admin finns i gruppen
if (invite.role === 'admin') {
  const existsAdmin = await Customer.exists({ groupId: invite.groupId, role: 'admin' });
  if (existsAdmin) {
    return res.status(409).json({ success: false, message: 'Det finns redan en admin för detta företag.' });
  }
}

   let newUser;
try {
  newUser = await Customer.create({
    name: (invite.name || "").trim(),
    email: invite.email,
    password: hashedPassword,
    role: invite.role || "user",
    groupId: invite.groupId
  });
} catch (e) {
  if (e && e.code === 11000) {
    return res.status(409).json({ success: false, message: 'Det finns redan en admin för detta företag.' });
  }
  throw e;
}

    // Markera inbjudan använd (single-use)
    invite.usedCount += 1;
    await invite.save();

    // SÄKER inloggning: regenerera session (skydd mot session fixation)
    req.session.regenerate(err => {
      if (err) {
        console.error("Session-regenerate fel:", err);
        return res.status(500).json({ success: false, message: "Sessionfel." });
      }
      req.session.user = {
        _id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        groupId: newUser.groupId,
        profileImage: newUser.profileImage || null,
        settings: newUser.settings || {}
      };
      return res.json({ success: true, message: "Konto skapat och inloggad.", userId: newUser._id });
    });
  } catch (err) {
    console.error("❌ Fel vid slutförande av inbjudan:", err);
    res.status(500).json({ success: false, message: "Serverfel." });
  }
});

/**
 * POST /api/invites/complete-first-admin
 * Löser in en "första admin"-inbjudan (isFirstAdmin=true, groupId=null).
 * Skapar första användaren som admin och sätter groupId = användarens _id.
 */
router.post('/complete-first-admin', async (req, res) => {
  try {
    const { token, name, password } = req.body || {};
    if (!token || !name || !password) {
      return res.status(400).json({ success: false, message: 'Saknar token, namn eller lösenord.' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ success: false, message: 'Lösenord måste vara minst 8 tecken.' });
    }

    const now = new Date();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const invite = await Invite.findOne({ tokenHash });

    if (!invite) {
      return res.status(404).json({ success: false, message: 'Ogiltig inbjudan.' });
    }
    if (invite.expiresAt <= now) {
      return res.status(410).json({ success: false, message: 'Inbjudan har gått ut.' });
    }
    if (invite.usedCount >= invite.maxUses) {
      return res.status(409).json({ success: false, message: 'Denna inbjudan har redan använts.' });
    }

    // Verifiera att detta verkligen är en first-admin‑invite
    if (!invite.isFirstAdmin || invite.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Denna länk är inte för första admin. Använd vanliga /complete.'
      });
    }

    // Skydda mot dubletter på e-post
    const existingByEmail = await Customer.findOne({ email: invite.email });
    if (existingByEmail) {
      return res.status(409).json({ success: false, message: 'E-postadressen är redan registrerad.' });
    }

    // Förskapa _id och använd det både som _id och groupId
    const newId = new mongoose.Types.ObjectId();
    const hashed = await bcrypt.hash(password, 10);

    let firstAdmin;
try {
  firstAdmin = await Customer.create({
    _id: newId,
    name: name.trim(),
    email: invite.email,      // alltid från inbjudan
    password: hashed,
    role: 'admin',
    groupId: newId            // första admin definierar företaget
  });
} catch (e) {
  // Om indexet (groupId + role:'admin') redan finns → stoppa snyggt
  if (e && e.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'Det finns redan en admin för detta företag.'
    });
  }
  throw e; // annat fel → låt yttersta catch hantera
}

    // Markera inbjudan använd (single-use)
    invite.usedCount += 1;
    await invite.save();

    // Logga in säkert (session fixation-skydd)
    req.session.regenerate(err => {
      if (err) {
        console.error('Session-regenerate fel:', err);
        return res.status(500).json({ success: false, message: 'Sessionfel.' });
      }
      req.session.user = {
        _id: firstAdmin._id,
        name: firstAdmin.name,
        email: firstAdmin.email,
        role: firstAdmin.role,
        groupId: firstAdmin.groupId,
        profileImage: firstAdmin.profileImage || null,
        settings: firstAdmin.settings || {}
      };
      return res.json({ success: true, message: 'Första admin skapad och inloggad.', userId: firstAdmin._id });
    });
  } catch (err) {
    console.error('Fel vid /api/invites/complete-first-admin:', err);
    return res.status(500).json({ success: false, message: 'Serverfel.' });
  }
});


router.get("/verify", async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ success: false, message: "Token saknas." });
  }

  try {
    const now = new Date();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const invite = await Invite.findOne({ tokenHash });

    if (!invite) {
      return res.status(404).json({ success: false, message: "Ogiltig inbjudan." });
    }
    if (invite.expiresAt <= now) {
      return res.status(410).json({ success: false, message: "Inbjudan har gått ut." });
    }
    if (invite.usedCount >= invite.maxUses) {
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
