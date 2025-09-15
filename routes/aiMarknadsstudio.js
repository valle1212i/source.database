// routes/aiMarknadsstudio.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { PDFDocument } = require("pdf-lib");
const sharp = require("sharp");

const Customers = require("../models/Customer");
const ai = require("../utils/aiUtils");

// ---------- Multer (public/uploads) ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, "../public/uploads");
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  },
});
const upload = multer({ storage });

// ---------- Helpers ----------
const NO_DEVICE_UI = "Do not depict any phone, tablet, laptop or screen, and do not show any app UI (no icons, buttons, toolbars, social media frames, profile headers, comment bars, web browser chrome, status bars, or device bezels).";

const NO_MOCKUP_GUARD = [
  "Render a flat 2D AD ARTWORK (key visual) that fills the entire canvas.",
  "Full-bleed, edge-to-edge, zero border or margin, no surrounding background.",
  "No frames, no poster-on-wall, no billboards, no paper rectangle.",
  "No mockups, no hands, no desk, no room, no floor.",
  "No photo studio/backdrops/softboxes/light stands/hanging lamps.",
  "No diorama/miniature set look.",
  "No third-party logos or watermarks.",
  NO_DEVICE_UI
].join(" ");

const stripTerms = [
  /poster/gi, /affisch/gi, /billboard/gi, /frame/gi, /ram/gi, /mockup/gi,
  /studio lighting/gi, /studio/gi, /photography studio/gi
];
function cleanUserText(s="") {
  let out = String(s || "");
  stripTerms.forEach(rx => out = out.replace(rx, ""));
  // snyggare mellanslag
  return out.replace(/\s{2,}/g, " ").trim();
}

function sanitizeExtras(extras = {}) {
  const safe = { ...extras };
  ["tone", "style", "brandName", "brandColors", "platform", "goal", "audience", "aspectRatio"]
    .forEach(k => safe[k] = cleanUserText(safe[k] || ""));
  // om style råkar bli tom, sätt en bra default
  if (!safe.style) {
    safe.style = "flat 2D ad artwork, full-bleed, edge-to-edge, high-contrast, print-ready";
  }
  return safe;
}

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
    const filePath = path.join(__dirname, "../public", url);
    if (!fs.existsSync(filePath)) throw new Error("Lokal fil saknas");
    return fs.readFileSync(filePath);
  }
  if (fs.existsSync(url)) return fs.readFileSync(url);
  const abs = absoluteUrl(req, url);
  const r = await fetch(abs);
  if (!r.ok) throw new Error(`Fetch misslyckades (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

// ====== prompt builders: använd “ad artwork / key visual”, ej “poster” ======
function buildBackgroundPrompt(description, extras = {}, overlayMode = "logo", ctaText = "") {
  const { aspectRatio = "1080x1350", tone = "modern, premium", style } = extras;

  const reserve = overlayMode === "main"
    ? "Reserve a clean CENTRAL focal area (negative space) for a product overlay; uncluttered layout."
    : "Leave a clean CORNER area suitable for a small logo overlay.";

  const ctaInstruction = (ctaText && ctaText.trim())
    ? `If text is allowed, typeset this CTA at the BOTTOM area, verbatim: "${ctaText}". Use clean sans-serif, high contrast, excellent legibility.`
    : "Do not render any text; just leave space where a CTA could go if needed.";

  const base = [
    "Create a professional advertising BACKGROUND for an ad artwork (key visual).",
    "Do NOT show a poster, frame, or thing placed in a scene; instead fill the canvas itself.",
    `Aspect ratio ${aspectRatio}. Visual tone: ${tone}. Style: ${style}.`,
    reserve,
    ctaInstruction,
    NO_MOCKUP_GUARD,
    "Avoid people and any real-world brand marks.",
    "User concept:", (description || "N/A")
  ].join("\n");
  return base;
}

function buildAdArtworkPrompt({ base, description, extras = {} }) {
  const {
    
    // platform is accepted but not printed to avoid UI/device mockups
    goal = "drive conversions / sales",
    audience = "primary target audience in Sweden",
    tone = "modern, clean, high-contrast",
    brandName = "Your brand",
    brandColors = "",
    ctaExact = "",
    aspectRatio = "1080x1350",
    style = "flat 2D ad artwork, full-bleed, edge-to-edge, high-contrast, print-ready",
  } = extras;

  const colors = (brandColors || "")
    .split(",").map(s => s.trim()).filter(Boolean).join(", ");

  const ctaBlock = ctaExact
    ? `Place this CTA text verbatim INSIDE the artwork (bottom area, clean sans-serif, high contrast): "${ctaExact}".`
    : `Leave space for a short headline/CTA but do NOT render any text.`;

  let prompt = [
    "Design a professional AD ARTWORK (key visual) as a flat 2D composition.",
    "The image you output IS the final artwork (full-bleed), not a photo of a poster or screen.",
    `Goal: ${goal}.`,
    `Target: ${audience}. Visual tone: ${tone}. Style: ${style}.`,
    "Distribution: digital advertising — do not show any device, display or app/interface elements.",
    ctaBlock,
    colors ? `Respect brand colors: ${colors}.` : "",
    `Aspect ratio ${aspectRatio}.`,
    "Focus on one strong focal point and generous negative space. Avoid excessive text.",
    NO_MOCKUP_GUARD,
    "User concept:", (description || "N/A")
  ].join("\n");

  if (base) prompt += `\n\nBase model hint:\n${base}`;
  return prompt;
}

// ====== komposition (overlay/logga/produkt + ev. CTA-band) ======
async function composeOverlay(bgBuf, overlayBuf, opts = {}) {
  const {
    mode = "logo", margin = 48,
    mainMaxRatio = 0.48, logoRatio = 0.18,
    corner = "tl", addShadow = true
  } = opts;

  const meta = await sharp(bgBuf).metadata();
  const W = meta.width, H = meta.height;

  let overlay = sharp(overlayBuf).png();
  const targetW = mode === "main" ? Math.round(W * mainMaxRatio) : Math.round(W * logoRatio);
  overlay = overlay.resize({ width: targetW });

  const overlayBufResized = await overlay.png().toBuffer();
  const ovMeta = await sharp(overlayBufResized).metadata();

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

  return await sharp(bgBuf).composite(composites).png().toBuffer();
}

function escapeXml(s="") {
  return s.replace(/[<>&'"]/g, c => ({ "<":"&lt;", ">":"&gt;", "&":"&amp;", "'":"&apos;", "\"":"&quot;" }[c]));
}
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
  return await sharp(imageBuf).composite([{ input: Buffer.from(svg), left: 0, top: H - bandH }]).png().toBuffer();
}

// ====== PDF-embed ======
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

// ================= ROUTE =================
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const description = cleanUserText(req.body.description || "");

    const overlayMode = (req.body.overlayMode || "logo").toString(); // none | logo | main
    const ctaEnabled  = String(req.body.ctaEnabled || "false") === "true";
    const ctaText     = ctaEnabled ? cleanUserText(req.body.cta || "") : "";
    const generationMode = (req.body.generationMode || "useUploadOnly").toString();

    const extrasRaw = {
      platform: req.body.platform,
      goal: req.body.goal,
      audience: req.body.audience,
      tone: req.body.tone,
      brandName: req.body.brandName,
      brandColors: req.body.brandColors,
      aspectRatio: req.body.aspectRatio,
      style: req.body.style,
      ctaExact: ctaText || ""
    };
    const extras = sanitizeExtras(extrasRaw);

    const base = await ai.createPromptFromDescription?.(description, {
      tone: extras.tone, style: extras.style, aspectRatio: extras.aspectRatio
    });

    const prompt = buildAdArtworkPrompt({ base, description, extras });

    let imageUrl, uint8, mime = "image/png";

    if (req.file) {
      const uploadBuf = fs.readFileSync(req.file.path);

      if (generationMode === "img2img" && typeof ai.generateImageFromPromptWithInit === "function") {
        try {
          const genUrl = await ai.generateImageFromPromptWithInit(uploadBuf, prompt, { size: "1024x1792" });
          const genRes = await fetch(genUrl);
          if (!genRes.ok) throw new Error(`Kunde inte hämta AI-bild (${genRes.status})`);
          let buf = Buffer.from(await genRes.arrayBuffer());
          if (ctaText) buf = await addCtaBand(buf, { cta: ctaText });

          const outDir = path.join(__dirname, "../public/generated");
          if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
          const outPngPath = path.join(outDir, `artwork-${Date.now()}.png`);
          fs.writeFileSync(outPngPath, buf);

          imageUrl = "/generated/" + path.basename(outPngPath);
          uint8 = new Uint8Array(buf);
        } catch (err) {
          // fallback: bakgrund + overlay
          const bgUrl = await ai.generateImageFromPrompt(
            buildBackgroundPrompt(description, extras, overlayMode, ctaText),
            { size: "1024x1792" }
          );
          const bgRes = await fetch(bgUrl);
          if (!bgRes.ok) throw new Error(`Kunde inte hämta AI-bakgrund (${bgRes.status})`);
          let bgBuf = Buffer.from(await bgRes.arrayBuffer());

          let composed = bgBuf;
          if (overlayMode === "logo") {
            composed = await composeOverlay(bgBuf, uploadBuf, { mode: "logo", corner: "tl" });
          } else if (overlayMode === "main") {
            composed = await composeOverlay(bgBuf, uploadBuf, { mode: "main" });
          }
          if (ctaText) composed = await addCtaBand(composed, { cta: ctaText });

          const outDir = path.join(__dirname, "../public/generated");
          if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
          const outPngPath = path.join(outDir, `artwork-${Date.now()}.png`);
          fs.writeFileSync(outPngPath, composed);
          imageUrl = "/generated/" + path.basename(outPngPath);
          uint8 = new Uint8Array(composed);
        }
      } else {
        // overlay-läge
        const bgUrl = await ai.generateImageFromPrompt(
          buildBackgroundPrompt(description, extras, overlayMode, ctaText),
          { size: "1024x1792" }
        );
        const bgRes = await fetch(bgUrl);
        if (!bgRes.ok) throw new Error(`Kunde inte hämta AI-bakgrund (${bgRes.status})`);
        let bgBuf = Buffer.from(await bgRes.arrayBuffer());

        let composed = bgBuf;
        if (overlayMode === "logo") {
          composed = await composeOverlay(bgBuf, uploadBuf, { mode: "logo", corner: "tl" });
        } else if (overlayMode === "main") {
          composed = await composeOverlay(bgBuf, uploadBuf, { mode: "main" });
        }
        if (ctaText) composed = await addCtaBand(composed, { cta: ctaText });

        const outDir = path.join(__dirname, "../public/generated");
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const outPngPath = path.join(outDir, `artwork-${Date.now()}.png`);
        fs.writeFileSync(outPngPath, composed);
        imageUrl = "/generated/" + path.basename(outPngPath);
        uint8 = new Uint8Array(composed);
      }
    } else {
      // text-only
      let genUrl;
      try {
        genUrl = await ai.generateImageFromPrompt(prompt, { size: "1024x1792" });
      } catch (e) {
        // fallback utan CTA i prompten
        const noCta = buildAdArtworkPrompt({ base, description, extras: { ...extras, ctaExact: "" } });
        genUrl = await ai.generateImageFromPrompt(noCta, { size: "1024x1792" });
      }
      const r = await fetch(genUrl);
      if (!r.ok) throw new Error(`Kunde inte hämta AI-bild (${r.status})`);
      let composed = Buffer.from(await r.arrayBuffer());
      if (ctaText) composed = await addCtaBand(composed, { cta: ctaText });

      const outDir = path.join(__dirname, "../public/generated");
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const outPngPath = path.join(outDir, `artwork-${Date.now()}.png`);
      fs.writeFileSync(outPngPath, composed);
      imageUrl = "/generated/" + path.basename(outPngPath);
      uint8 = new Uint8Array(composed);
    }

    // PDF
    const pdfDoc = await PDFDocument.create();
    const { img, width, height } = await embedImageAuto(pdfDoc, uint8, mime);
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(img, { x: 0, y: 0, width, height });
    const pdfBytes = await pdfDoc.save();

    const outDir = path.join(__dirname, "../public/generated");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const pdfPath = path.join(outDir, `artwork-${Date.now()}.pdf`);
    fs.writeFileSync(pdfPath, pdfBytes);
    const pdfUrl = "/generated/" + path.basename(pdfPath);

    // autosave (icke-blockerande)
    (async () => {
      try {
        const sessionEmail = req.user?.email;
        const userEmail = sessionEmail || (req.body.userEmail ? String(req.body.userEmail) : null);
        if (!userEmail) return;

        const customer = await Customers.findOne({ email: userEmail }).lean();
        if (!customer) return;

        const marketing = customer.marketing || {};
        const existingAssets = Array.isArray(marketing?.aiStudio?.assets) ? marketing.aiStudio.assets : [];
        const existingContentTypes = Array.isArray(marketing?.aiStudio?.contentTypes) ? marketing.aiStudio.contentTypes : [];
        const existingCampaigns = Array.isArray(marketing?.aiStudio?.campaigns) ? marketing.aiStudio.campaigns : [];

        const updated = {
          ...marketing,
          aiStudio: {
            ...(marketing.aiStudio || {}),
            assets: [...existingAssets, imageUrl],
            contentTypes: Array.from(new Set([...existingContentTypes, "image"])),
            campaigns: [
              ...existingCampaigns,
              {
                platform: extras.platform,
                goal: extras.goal,
                audience: extras.audience,
                tone: extras.tone,
                brandName: extras.brandName,
                brandColors: extras.brandColors,
                aspectRatio: extras.aspectRatio,
                style: extras.style,
                overlayMode,
                ctaEnabled,
                cta: ctaText
              }
            ],
            notes: description,
            updatedAt: new Date().toISOString()
          },
          updatedAt: new Date().toISOString()
        };

        await Customers.updateOne({ _id: customer._id }, { $set: { marketing: updated } });
      } catch (e) {
        console.warn("🟡 aiStudio autosave misslyckades:", e?.message || e);
      }
    })();

    res.json({ imageUrl, pdfUrl, promptUsed: prompt, source: req.file ? "upload" : "text-only" });

  } catch (error) {
    console.error("❌ AI-fel:", error);
    const msg = String(error?.message || "");
    if (/content_policy_violation|safety|not allowed/i.test(msg)) {
      return res.status(400).json({ error: "Kunde inte generera bild eller PDF", detail: msg });
    }
    return res.status(500).json({ error: "Kunde inte generera bild eller PDF", detail: msg });
  }
});

// GET – generera PDF från imageUrl
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

// PROXY – ladda ned bild
router.get("/download-image", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Ingen URL angiven");

  try {
    let ct = "image/jpeg";
    let buf;

    if (isLocalUpload(url)) {
      const filePath = path.join(__dirname, "../public", url);
      if (!fs.existsSync(filePath)) return res.status(404).send("Filen finns inte");
      buf = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      if (ext === ".png") ct = "image/png";
      else if (ext === ".webp") ct = "image/webp";
      else if (ext === ".gif") ct = "image/gif";
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

module.exports = router;
