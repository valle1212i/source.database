const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { createPromptFromDescription, generateImageFromPrompt } = require("../utils/aiUtils");
const { PDFDocument } = require("pdf-lib");

// Multer setup
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, "../public/uploads");
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  }
});
const upload = multer({ storage });

// 📥 POST: Skapa prompt + bild + PDF
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const description = req.body.description || "";
    console.log("📨 Beskrivning mottagen:", description);

    const prompt = await createPromptFromDescription(description);
    console.log("🤖 Genererad prompt:", prompt);

    const imageUrl = await generateImageFromPrompt(prompt);
    console.log("🖼️ Bildgenererad URL:", imageUrl);

    // ⬇️ Använd uppladdad bild om den finns, annars hämta AI-bild
    let imageBuffer;
    if (req.file) {
      console.log("📸 Använd uppladdad bild:", req.file.path);
      imageBuffer = fs.readFileSync(req.file.path);
    } else {
      const imageResponse = await fetch(imageUrl);
      imageBuffer = await imageResponse.arrayBuffer();
    }

    // 🧾 Skapa PDF
    const pdfDoc = await PDFDocument.create();
    const img = await pdfDoc.embedPng(imageBuffer);
    const page = pdfDoc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });

    const pdfBytes = await pdfDoc.save();

    // 💾 Spara PDF till filsystemet
    const pdfDir = path.join(__dirname, "../public/generated");
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });

    const pdfPath = path.join(pdfDir, `poster-${Date.now()}.pdf`);
    fs.writeFileSync(pdfPath, pdfBytes);

    const pdfUrl = "/generated/" + path.basename(pdfPath);
    res.json({ imageUrl, pdfUrl });

  } catch (error) {
    console.error("❌ AI-fel:", error);
    res.status(500).json({ error: "Kunde inte generera bild eller PDF" });
  }
});

// 🆕 GET: Returnera PDF direkt från imageUrl
router.get("/pdf", async (req, res) => {
  try {
    const imageUrl = req.query.imageUrl;
    if (!imageUrl) return res.status(400).send("Ingen bild-URL angiven.");

    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();

    const pdfDoc = await PDFDocument.create();
    const img = await pdfDoc.embedPng(imageBuffer);
    const page = pdfDoc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });

    const pdfBytes = await pdfDoc.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=ai-bild.pdf");
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error("❌ Fel vid PDF-generering:", error);
    res.status(500).send("Kunde inte generera PDF");
  }
});

module.exports = router;
