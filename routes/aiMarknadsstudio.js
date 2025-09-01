// routes/aiMarknadsstudio.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { PDFDocument } = require("pdf-lib");
const sharp = require("sharp"); // komposition & typografiband

// Node 18+ har global fetch. För Node 16/17:
// 
const ai = require("../utils/aiUtils"); // createPromptFromDescription, generateImageFromPrompt, (ev) generateImageFromPromptWithInit

// ---------- Multer (privat uploads) ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, "../uploads");
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  }
});
const upload = multer({ storage });


// ---------- Helpers ----------
function isHttpUrl(u) { return /^https?:\/\//i.test(u || ""); }
function isLocalUpload(u) { return typeof u === "string" && u.startsWith("/uploads/"); }
function absoluteUrl(req, relative) {
  const r = relative.startsWith("/") ? relative : `/${relative}`;
  return `${req.protocol}://${req.get("host")}${r}`;
}
async function bufferFromUrlOrLocal(url, req) {
  if (isHttpUrl(url)) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Fetch misslyckades (${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }
  if (isLocalUpload(url)) {
  const rel = String(url || "").replace(/^[\\/]?uploads[\\/]?/i, "");
  const normalized = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(__dirname, "../uploads", normalized);

  if (!fs.existsSync(filePath)) throw new Error("Lokal fil saknas");
  return fs.readFileSync(filePath);
}
  if (fs.existsSync(url)) return fs.readFileSync(url);
  const abs = absoluteUrl(req, url);
  const r = await fetch(abs);
  if (!r.ok) throw new Error(`Fetch misslyckades (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

// ====== AD-BAKGRUND (PROFESSIONELL POSTER) ======

/**
 * Bygger en "ad‑ready" bakgrundsprompt.
 * - Negativt utrymme
 * - Studioljus/premium
 * - Om overlayMode === 'main': reservera mitt‑yta för produkt
 * - Om ctaText finns: be modellen TYPSÄTTA exakt CTA‑text i nederkant
 */
function buildAdBackgroundPrompt(description, extras = {}, overlayMode = "logo", ctaText = "") {
  const {
    aspectRatio = "1080x1350",
    tone = "modern, premium",
    style = "photorealistic, high quality, studio lighting, soft shadows",
  } = extras;

  const reserve = overlayMode === "main"
    ? "Reserve central area (negative space) for a product overlay; keep it clean and uncluttered."
    : "Leave a clean corner area suitable for a small logo overlay.";

  const ctaInstruction = (ctaText && ctaText.trim())
    ? `Typeset the exact CTA text inside the artwork at the bottom center (verbatim): "${ctaText}". Use clean sans-serif typography, high contrast, and perfect legibility.`
    : "Do not add any text; only leave negative space suitable for a CTA if needed.";

  return `Generate a royalty-free AD BACKGROUND ONLY (no third-party logos, no brand marks, no watermarks).
It must look like a professional marketing poster backdrop with NEGATIVE SPACE and premium studio look.
Aspect ratio ${aspectRatio}. Visual tone: ${tone}. Style: ${style}.
${reserve}
${ctaInstruction}
Avoid people and avoid any real-world brand logos. The scene should support a commercial product hero. 
Keep edges clean and free of artifacts.

Inspiration/concept from the user:
${description || "N/A"}`;
}

/**
 * Robust bakgrundsgenerering – med fallback om safety triggas.
 * - Försök med CTA inbakad i motivet om ctaText finns
 * - Fallback: utan text (vi lägger CTA i efterhand om nödvändigt)
 */
async function safeGenerateAdBackground(description, extras, overlayMode, ctaText) {
  try {
    return await ai.generateImageFromPrompt(
      buildAdBackgroundPrompt(description, extras, overlayMode, ctaText)
    );
  } catch (e) {
    const msg = String(e?.message || "");
    if (/content_policy_violation|safety|not allowed/i.test(msg)) {
      // försök igen, men utan text i motivet (vi renderar CTA lokalt)
      return await ai.generateImageFromPrompt(
        buildAdBackgroundPrompt(description, extras, overlayMode, "")
      );
    }
    throw e;
  }
}

// ====== KOMPOSITION (LOGGA/PRODUKT + EV. CTA SOM BAND) ======

async function composeOverlay(bgBuf, overlayBuf, opts = {}) {
  const {
    mode = "logo",          // "logo" | "main"
    margin = 48,
    mainMaxRatio = 0.45,    // max produktbredd i % av canvasbredd
    logoRatio = 0.18,       // loggans bredd i % av canvasbredd
    corner = "tl",          // tl | tr | bl | br
    addShadow = true
  } = opts;

  const bg = sharp(bgBuf);
  const meta = await bg.metadata();
  const W = meta.width, H = meta.height;

  let overlay = sharp(overlayBuf).png();

  // Skala
  let targetW = mode === "main"
    ? Math.round(W * mainMaxRatio)
    : Math.round(W * logoRatio);
  overlay = overlay.resize({ width: targetW });

  let overlayBufResized = await overlay.png().toBuffer();
  const ovMeta = await sharp(overlayBufResized).metadata();

  // En enkel “skugga”
  let composites = [];
  if (addShadow) {
    const blur = Math.max(10, Math.round(W * 0.02));
    const shadow = await sharp({
      create: {
        width: ovMeta.width + margin,
        height: ovMeta.height + margin,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0.35 }
      }
    }).blur(blur).png().toBuffer();
    composites.push({ input: shadow, left: 0, top: 0 });
  }

  // Placering
  let left = 0, top = 0;
  if (mode === "main") {
    left = Math.round((W - ovMeta.width) / 2);
    top  = Math.round((H - ovMeta.height) / 2);
  } else {
    const xMap = { tl: margin, tr: W - ovMeta.width - margin, bl: margin, br: W - ovMeta.width - margin };
    const yMap = { tl: margin, tr: margin, bl: H - ovMeta.height - margin, br: H - ovMeta.height - margin };
    left = xMap[corner] ?? margin;
    top  = yMap[corner] ?? margin;
  }

  composites = composites.map(c => ({ ...c, left: left - Math.round(margin/2), top: top - Math.round(margin/2) }));
  composites.push({ input: overlayBufResized, left, top });

  return await sharp(bgBuf)
    .composite(composites)
    .png()
    .toBuffer();
}

function escapeXml(s = "") {
  return s.replace(/[<>&'"]/g, c => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;"
  }[c]));
}

/** Lokal CTA (failsafe) – används endast om modellen inte fick med texten */
async function addCtaBand(imageBuf, { cta = "", margin = 40 } = {}) {
  if (!cta || !cta.trim()) return imageBuf;
  const meta = await sharp(imageBuf).metadata();
  const W = meta.width, H = meta.height;
  const fontSize = Math.max(36, Math.round(W * 0.045));
  const bandH = Math.round(fontSize * 2.2);
  const svg = `
    <svg width="${W}" height="${bandH}">
      <rect x="0" y="0" width="${W}" height="${bandH}" fill="black" fill-opacity="0.35"/>
      <text x="${margin}" y="${Math.round(fontSize*1.4)}"
            font-family="Inter, Arial, sans-serif"
            font-size="${fontSize}" fill="#ffffff">${escapeXml(cta)}</text>
    </svg>`;
  return await sharp(imageBuf)
    .composite([{ input: Buffer.from(svg), left: 0, top: H - bandH }])
    .png()
    .toBuffer();
}

// ====== PDF-INBÄDDNING ======
async function embedImageAuto(pdfDoc, uint8, mimeHint) {
  const isPng = mimeHint?.includes("png") || (uint8[0] === 0x89 && uint8[1] === 0x50);
  if (isPng) {
    const img = await pdfDoc.embedPng(uint8);
    return { img, width: img.width, height: img.height };
  } else {
    const img = await pdfDoc.embedJpg(uint8);
    return { img, width: img.width, height: img.height };
  }
}

// ====== PROMPT FÖR MARKNADSVISUELL ======
function buildMarketingPrompt({ base, description, extras = {} }) {
  const {
    platform = "Meta + Google",
    goal = "drive conversions / sales",
    audience = "primary target audience in Sweden",
    tone = "modern, clean, high-contrast",
    brandName = "Your brand",
    brandColors = "",
    ctaExact = "",                 // NYTT: exakt CTA‑text om vi vill att modellen ska sätta den
    aspectRatio = "1080x1350",
    style = "minimalist, crisp lighting, sharp focus",
  } = extras;

  const colors = (brandColors || "")
    .split(",").map(s => s.trim()).filter(Boolean).join(", ");

  const ctaBlock = ctaExact
    ? `Place the following CTA text verbatim in the artwork, bottom area with high contrast, clean sans-serif typography: "${ctaExact}".`
    : `Leave space for a short headline and CTA (do not render any text).`;

  const prompt =
`Design a professional marketing poster for ${brandName}.
Platform(s): ${platform}. Campaign goal: ${goal}.
Target: ${audience}. Visual tone: ${tone}. Style: ${style}.
${ctaBlock}
Respect brand consistency${colors ? ` using brand colors: ${colors}` : ""}.
Aspect ratio ${aspectRatio}. Keep composition ad-friendly (clear focal point, negative space, studio quality).
Avoid excessive text; focus on product/benefit with strong focal point and professional lighting.

Concept details from the user:
${description || "N/A"}

Additional guidance:
- Performance-ad look: thumb-stopping, clear value prop.
- Color contrast to highlight CTA if present.
- Legible typography, minimal artifacts.
- No third-party logos or trademarks unless provided by user overlay.`;

  return base ? `${prompt}\n\nBase model hint:\n${base}` : prompt;
}

// ================= ROUTE =================

router.post("/", upload.single("image"), async (req, res) => {
  try {
    const description = (req.body.description || "").toString();

    // Frontend-parametrar
    const overlayMode = (req.body.overlayMode || "logo").toString();      // "none" | "logo" | "main"
    const ctaEnabled  = String(req.body.ctaEnabled || "false") === "true";
    const ctaText     = ctaEnabled ? (req.body.cta || "").toString() : "";

    const extras = {
      platform: req.body.platform,
      goal: req.body.goal,
      audience: req.body.audience,
      tone: req.body.tone,
      brandName: req.body.brandName,
      brandColors: req.body.brandColors,
      aspectRatio: req.body.aspectRatio,
      style: req.body.style,
      // skickas in i "marketingprompten" för att instruera modellen att typsätta CTA i motivet
      ctaExact: ctaText || ""
    };

    const generationMode = (req.body.generationMode || "useUploadOnly").toString();

    // Basprompt (för ev. image‑modeler som tar textprompt)
    const basePrompt = await ai.createPromptFromDescription(description);
    const prompt = buildMarketingPrompt({ base: basePrompt, description, extras });
    console.log("🤖 Prompt:", prompt);

    let imageUrl; // till klienten
    let uint8;    // bytes för PDF
    let mime = "";

    // === MED FIL ===
    if (req.file) {
      const uploadBuf = fs.readFileSync(req.file.path);

      // 1) Generera ad‑bakgrund – först med CTA inbakad i motivet.
      //    Triggar detta safety => fallback utan text.
      const bgUrl = await safeGenerateAdBackground(description, extras, overlayMode, ctaText);
      const bgRes = await fetch(bgUrl);
      if (!bgRes.ok) throw new Error(`Kunde inte hämta AI-bakgrund (${bgRes.status})`);
      let bgBuf = Buffer.from(await bgRes.arrayBuffer());

      // 2) Komposita produkt/logga enligt val
      let composed = bgBuf;
      if (overlayMode === "logo") {
        composed = await composeOverlay(bgBuf, uploadBuf, { mode: "logo", corner: "tl" });
      } else if (overlayMode === "main") {
        composed = await composeOverlay(bgBuf, uploadBuf, { mode: "main" });
      } // "none" => bara bakgrund

      // 3) Om modellen inte skrev CTA (t.ex. safety‑fallback gav bakgrund UTAN text)
      //    så lägger vi CTA som band lokalt.
      if (ctaText) {
        // Heuristik: vi lägger bandet alltid vid ev. fallback; 
        // (Vill du detektera text i bilden krävs OCR – hoppat här)
        const usedPromptIncludedCTA = true; // vi bad om det
        // Om bakgrunden kom från fallback (utan CTA), safeGenerateAdBackground ovan var redan utan text.
        // Vi kan anta att CTA saknas och lägga bandet:
        if (bgUrl && !bgUrl.includes("http")) {
          // (skulle inte hända här) – lämna
        }
        // Lägg bandet som failsafe:
        composed = await addCtaBand(composed, { cta: ctaText, margin: 40 });
      }

      // 4) Spara PNG lokalt (privat) + säker nedladdningslänk via route
const genDir = path.join(__dirname, "../generated"); // inte under /public
if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });

const fileName = `poster-${Date.now()}.png`;
const outPngPath = path.join(genDir, fileName);
fs.writeFileSync(outPngPath, composed);

// Bygg länk mot vår nya säkra route (respektera hur routern är mountad)
const base = req.baseUrl || "";
imageUrl = `${base}/generated?file=${encodeURIComponent(fileName)}`;

uint8 = new Uint8Array(composed);
mime = "image/png";

    } else {
      // === UTAN FIL: ad‑bakgrund (med CTA inbakad om möjligt), annars CTA‑band lokalt
      let usedFallbackNoCta = false;
      let bgUrl;
      try {
        bgUrl = await ai.generateImageFromPrompt(
          buildAdBackgroundPrompt(description, extras, "none", ctaText)
        );
      } catch (e) {
        const msg = String(e?.message || "");
        if (/content_policy_violation|safety|not allowed/i.test(msg)) {
          usedFallbackNoCta = true;
          bgUrl = await ai.generateImageFromPrompt(
            buildAdBackgroundPrompt(description, extras, "none", "")
          );
        } else throw e;
      }
      const r = await fetch(bgUrl);
      if (!r.ok) throw new Error(`Kunde inte hämta AI-bild (${r.status})`);
      let composed = Buffer.from(await r.arrayBuffer());

      if (ctaText && usedFallbackNoCta) {
        composed = await addCtaBand(composed, { cta: ctaText, margin: 40 });
      }

      // Spara PNG lokalt (privat) + säker nedladdningslänk via route
const genDir = path.join(__dirname, "../generated"); // inte under /public
if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });

const fileName = `poster-${Date.now()}.png`;
const outPngPath = path.join(genDir, fileName);
fs.writeFileSync(outPngPath, composed);

// Bygg länk mot vår nya säkra route (respektera hur routern är mountad)
const base = req.baseUrl || "";
imageUrl = `${base}/generated?file=${encodeURIComponent(fileName)}`;

uint8 = new Uint8Array(composed);
mime = "image/png";
    }

    // 🧾 Skapa PDF
    const pdfDoc = await PDFDocument.create();
    const { img, width, height } = await embedImageAuto(pdfDoc, uint8, mime);
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(img, { x: 0, y: 0, width, height });
    const pdfBytes = await pdfDoc.save();

    // 💾 Spara PDF (privat) + säker nedladdningslänk via route
const pdfDir = path.join(__dirname, "../generated"); // inte under /public
if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });

const pdfName = `poster-${Date.now()}.pdf`;
const pdfPath = path.join(pdfDir, pdfName);
fs.writeFileSync(pdfPath, pdfBytes);

// Bygg länk mot vår nya säkra route
const base = req.baseUrl || "";
const pdfUrl = `${base}/generated?file=${encodeURIComponent(pdfName)}`;

    res.json({
      imageUrl,
      pdfUrl,
      promptUsed: prompt,
      source: req.file ? "upload+compose" : "ai"
    });

  } catch (error) {
    console.error("❌ AI-fel:", error);
    const msg = String(error?.message || "");
    if (/content_policy_violation|safety|not allowed/i.test(msg)) {
      return res.status(400).json({ error: "Kunde inte generera bild eller PDF", detail: msg });
    }
    return res.status(500).json({ error: "Kunde inte generera bild eller PDF", detail: msg });
  }
});

// GET – generera PDF från imageUrl (http eller /uploads/…)
router.get("/pdf", async (req, res) => {
  try {
    const imageUrl = req.query.imageUrl;
    if (!imageUrl) return res.status(400).send("Ingen bild-URL angiven.");

    const buf = await bufferFromUrlOrLocal(imageUrl, req);
    const uint8 = new Uint8Array(buf);

    const mime = imageUrl.endsWith(".png") ? "image/png"
      : imageUrl.endsWith(".webp") ? "image/webp"
      : imageUrl.endsWith(".gif") ? "image/gif"
      : "image/jpeg";

    const pdfDoc = await PDFDocument.create();
    const { img, width, height } = await embedImageAuto(pdfDoc, uint8, mime);
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(img, { x: 0, y: 0, width, height });
    const pdfBytes = await pdfDoc.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=ai-bild.pdf");
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error("❌ Fel vid PDF-generering:", error);
    res.status(500).send("Kunde inte generera PDF");
  }
});

// PROXY – ladda ned bild (http eller /uploads/…)
router.get("/download-image", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Ingen URL angiven");

  try {
    let ct = "image/jpeg";
    let buf;

    if (isLocalUpload(url)) {
  // Normalisera sökväg och förhindra ../
  const rel = String(url || "").replace(/^[\\/]?uploads[\\/]?/i, "");
  const normalized = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(__dirname, "../uploads", normalized);

  if (!fs.existsSync(filePath)) return res.status(404).send("Filen finns inte");
  buf = fs.readFileSync(filePath);

  // MIME-vitlista efter filändelse
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") ct = "image/png";
  else if (ext === ".webp") ct = "image/webp";
  else if (ext === ".gif") ct = "image/gif";
  else ct = "image/jpeg";
} else {
      const r = await fetch(isHttpUrl(url) ? url : absoluteUrl(req, url));
      if (!r.ok) return res.status(400).send("Kunde inte hämta bild");
      ct = r.headers.get("content-type") || ct;
      buf = Buffer.from(await r.arrayBuffer());
    }

    const ext = ct.includes("png") ? "png"
              : ct.includes("webp") ? "webp"
              : ct.includes("gif") ? "gif"
              : "jpg";

    res.setHeader("Content-Type", ct);
    res.setHeader("Content-Disposition", `attachment; filename="ai-bild.${ext}"`);
    res.send(buf);
  } catch (e) {
    console.error("download-image fel:", e);
    res.status(500).send("Kunde inte ladda ned bilden");
  }
});

// SECURE DOWNLOAD – genererade filer (PNG/PDF) med path-säkring
router.get("/generated", (req, res) => {
  try {
    const file = String(req.query.file || "");
    if (!file) return res.status(400).send("Saknar filparameter.");

    // Tillåt bara kända ändelser
    const allowed = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf"];
    const ext = path.extname(file).toLowerCase();
    if (!allowed.includes(ext)) return res.status(400).send("Ogiltig filtyp.");

    // Normalisera och blockera stigklättring
    const normalized = path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, "");
    const filePath = path.join(__dirname, "../generated", normalized);

    if (!fs.existsSync(filePath)) return res.status(404).send("Filen finns inte.");

    // Bestäm Content-Type
    const ct = ext === ".png"  ? "image/png"  :
               ext === ".webp" ? "image/webp" :
               ext === ".gif"  ? "image/gif"  :
               ext === ".pdf"  ? "application/pdf" :
               (ext === ".jpg" || ext === ".jpeg") ? "image/jpeg" : "application/octet-stream";

    res.setHeader("Content-Type", ct);
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(normalized)}"`);
    res.send(fs.readFileSync(filePath));
  } catch (e) {
    console.error("generated download fel:", e);
    res.status(500).send("Kunde inte ladda ned filen.");
  }
});

module.exports = router;
