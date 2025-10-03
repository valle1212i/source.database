const express = require("express");
const router = express.Router();
const LoginEvent = require("../models/LoginEvent");
const Customer = require("../models/Customer");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const crypto = require("crypto");


// ✅ Använd EN central middleware för auth
const requireAuth = require("../middleware/requireAuth");

// GET: Senaste inloggningar för inloggad användare
router.get("/logins", requireAuth, async (req, res) => {
  try {
    const logins = await LoginEvent.find({ userId: req.session.user._id })
      .sort({ timestamp: -1 })
      .limit(10);

    res.json({
      success: true,
      logins: logins.map((entry) => ({
        timestamp: new Date(entry.timestamp).toLocaleString("sv-SE"),
        ip: entry.ip,
        device: entry.device,
      })),
    });
  } catch (err) {
    console.error("Fel vid hämtning av inloggningar:", err);
    res
      .status(500)
      .json({ success: false, message: "Kunde inte hämta historik" });
  }
});
// === 2FA helpers ===

// Skapa 10 läsbara backupkoder (returnerar klartext + hash-lista).
function generateBackupCodes() {
  const codes = [];
  for (let i = 0; i < 10; i++) {
    // 10 tecken base36 -> görs mer läsbart i grupper
    const raw = crypto.randomBytes(8).toString("base64url").slice(0, 10);
    const pretty = `${raw.slice(0,4)}-${raw.slice(4,7)}-${raw.slice(7,10)}`;
    codes.push(pretty.toUpperCase());
  }
  // Hasha med SHA-256 (enkelt, ingen extra dependency). Visas bara i klartext en gång.
  const hashed = codes.map(c => crypto.createHash("sha256").update(c).digest("hex"));
  return { codes, hashed };
}

// Säkerställ att arrayen methods innehåller 'totp' utan dubbletter
function ensureMethod(methods, method) {
  const set = new Set(Array.isArray(methods) ? methods : []);
  set.add(method);
  return Array.from(set);
}

// GET: Alla inloggningar (endast för admin)
router.get("/all-logins", requireAuth, async (req, res) => {
  const isAdmin = req.session.user?.role === "admin";
  if (!isAdmin) {
    return res
      .status(403)
      .json({ success: false, message: "Åtkomst nekad" });
  }

  try {
    const events = await LoginEvent.find({})
      .sort({ timestamp: -1 })
      .limit(50)
      .populate("userId", "name email");

    const formatted = events.map((entry) => ({
      timestamp: new Date(entry.timestamp).toLocaleString("sv-SE"),
      ip: entry.ip,
      device: entry.device,
      name: entry.userId?.name || "Okänd",
      email: entry.userId?.email || "okänd@domän.se",
    }));

    res.json({ success: true, logins: formatted });
  } catch (err) {
    console.error("Fel vid hämtning av all loggdata:", err);
    res
      .status(500)
      .json({ success: false, message: "Misslyckades att hämta loggar" });
  }
});
// GET /api/security/2fa/status
router.get("/2fa/status", requireAuth, async (req, res) => {
  try {
    const me = await Customer.findById(req.session.user._id).lean();
    if (!me) return res.status(404).json({ success: false, message: "Användare saknas" });

    const twofa = me.twofa || {};
    const hasTotp = !!(twofa.enabled && twofa.methods && twofa.methods.includes("totp"));
    const hasWebAuthn = !!(twofa.webauthn && twofa.webauthn.length);

    return res.json({
      success: true,
      enabled: !!twofa.enabled,
      methods: twofa.methods || [],
      hasTotp,
      hasWebAuthn,
      backupCodesCount: Array.isArray(twofa.backupCodes) ? twofa.backupCodes.length : 0
    });
  } catch (e) {
    console.error("2FA status fel:", e);
    res.status(500).json({ success:false, message:"Kunde inte läsa 2FA-status" });
  }
});

// POST /api/security/2fa/totp/init
// Starta TOTP-setup: generera secret + QR som dataURL. Lagra temporärt i session.
router.post("/2fa/totp/init", requireAuth, async (req, res) => {
  try {
    const me = await Customer.findById(req.session.user._id).lean();
    if (!me) return res.status(404).json({ success: false, message: "Användare saknas" });

    // App-namn i authenticatorn (visa tenant om finns)
    const appLabel = me.tenant ? `Source (${me.tenant})` : "Source";
    const label = `${appLabel}:${me.email}`;

    const secret = speakeasy.generateSecret({
      name: label,
      length: 20
    });

    // Spara temporärt i session tills verify godkänns
    if (!req.session) return res.status(500).json({ success:false, message:"Session otillgänglig" });
    req.session.totpSetup = { base32: secret.base32, createdAt: Date.now() };

    const otpauth = secret.otpauth_url;
    const qr = await QRCode.toDataURL(otpauth);

    return res.json({
      success: true,
      qr,                // data:image/png;base64,....
      secret: secret.base32 // kan döljas i prod – här returneras för dev/debug
    });
  } catch (e) {
    console.error("2FA init fel:", e);
    res.status(500).json({ success:false, message:"Kunde inte initiera 2FA" });
  }
});

// POST /api/security/2fa/totp/verify
// Verifiera 6-siffrig kod från appen, aktivera TOTP och generera backupkoder
router.post("/2fa/totp/verify", requireAuth, async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ success:false, message:"Saknar kod" });

    const pending = req.session?.totpSetup?.base32;
    if (!pending) return res.status(400).json({ success:false, message:"Ingen 2FA-setup påbörjad" });

    const ok = speakeasy.totp.verify({
      secret: pending,
      encoding: "base32",
      token: String(token).trim(),
      window: 1 // lite slack
    });

    if (!ok) return res.status(400).json({ success:false, message:"Felaktig kod" });

    // Generera backupkoder
    const { codes, hashed } = generateBackupCodes();

    // Aktivera i DB
    await Customer.findByIdAndUpdate(
      req.session.user._id,
      {
        $set: {
          "twofa.enabled": true,
          "twofa.secret": pending,
          "twofa.methods": ensureMethod([], "totp"),
          "twofa.backupCodes": hashed
        }
      }
    );

    // Rensa temporär secret i session
    delete req.session.totpSetup;

    // returnera klartext-koder EN gång
    return res.json({ success:true, backupCodes: codes });
  } catch (e) {
    console.error("2FA verify fel:", e);
    res.status(500).json({ success:false, message:"Kunde inte aktivera 2FA" });
  }
});

// POST /api/security/2fa/backup-codes/regenerate
// Skapa nya backupkoder, skriv över gamla, returnera EN gång
router.post("/2fa/backup-codes/regenerate", requireAuth, async (req, res) => {
  try {
    const me = await Customer.findById(req.session.user._id).lean();
    if (!me) return res.status(404).json({ success:false, message:"Användare saknas" });

    if (!me.twofa?.enabled) {
      return res.status(400).json({ success:false, message:"2FA ej aktiverad" });
    }

    const { codes, hashed } = generateBackupCodes();

    await Customer.findByIdAndUpdate(
      req.session.user._id,
      { $set: { "twofa.backupCodes": hashed } }
    );

    return res.json({ success:true, backupCodes: codes });
  } catch (e) {
    console.error("2FA backup regenerate fel:", e);
    res.status(500).json({ success:false, message:"Kunde inte skapa backupkoder" });
  }
});

// ✅ Exportera routern och (vid behov) samma requireAuth som re-export
module.exports = {
  router,
  requireAuth,
};
