// utils/aiUtils.js
const fs = require("fs");
const path = require("path");
const os = require("os");
const OpenAI = require("openai");

if (!process.env.OPENAI_API_KEY) {
  console.warn("[aiUtils] OPENAI_API_KEY saknas – bildgenerering kommer att fallera.");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* -----------------------------------------------------------
   Hjälpare
----------------------------------------------------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Antimockup / antistudio-hint som injiceras i alla prompts */
const NO_MOCKUP_HINT = [
  "flat 2D advertising artwork, full-bleed, edge-to-edge",
  "no frames, no borders, no walls, no poster-on-wall, no billboards, no paper rectangle",
  "no mockups, no hands, no desk, no room, no floor",
  "no photo studio/backdrops/softboxes/light stands/hanging lamps",
  "no diorama/miniature look",
  "no third-party logos or watermarks"
].join("; ");

/** Säkerhets-omsrivning för text → policy-vänlig prompt */
async function rewriteForSafety(original) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 180,
      messages: [
        {
          role: "system",
          content:
            "Rewrite the user's text into a policy-safe prompt for a commercial, royalty-free image. Remove third-party brand names and sensitive content. Keep the marketing intent and scene description. Respond only with the rewritten English text."
        },
        { role: "user", content: String(original || "") }
      ]
    });
    const text = completion?.choices?.[0]?.message?.content?.trim();
    return text || original;
  } catch {
    return original;
  }
}

/** Kort basprompt för att förädla beskrivningen (utan studio-bias) */
async function createPromptFromDescription(description, opts = {}) {
  const {
    tone = "modern, premium, high-contrast",
    style = "flat 2D advertising artwork, full-bleed, print-ready, minimal artifacts",
    aspectRatio = "1080x1350"
  } = opts;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.5,
    max_tokens: 160,
    messages: [
      {
        role: "system",
        content:
          "You write concise prompts for AI image generation focused on professional advertising artwork (no mockups). Always reply in English."
      },
      {
        role: "user",
        content: [
          "Turn this idea into a short, vivid image prompt for a commercial, royalty-free visual:",
          "---",
          String(description || "N/A"),
          "---",
          `Target: professional ad artwork (social media ready).`,
          `Tone: ${tone}.`,
          `Style: ${style}.`,
          `Aspect ratio: ${aspectRatio}.`,
          `Avoid third-party brand logos or watermarks. Avoid frames, borders, mockups, and white paper rectangles. AND any phone/tablet/screen or app UI (icons, buttons, toolbars, social feed frames). Keep text minimal unless explicitly provided.`,
          `Critical constraints: ${NO_MOCKUP_HINT}.`
        ].join("\n")
      }
    ]
  });

  return completion.choices?.[0]?.message?.content?.trim() || "";
}

/* -----------------------------------------------------------
   TEXT → BILD (robust med fallbacks)
----------------------------------------------------------- */
/**
 * generateImageFromPrompt(prompt, { size="1024x1024", attempts=3 })
 * - Primärt gpt-image-1
 * - Vid policy/behörighet → omskriv/bytes till DALL·E 3
 */
async function generateImageFromPrompt(prompt, options = {}) {
  const size = options.size || "1024x1024";
  const attempts = Math.max(1, options.attempts || 3);

  // Injicera anti-mockup om inte användaren redan lagt till något liknande
  let currentPrompt = String(prompt || "");
  if (!/no mockup|no frames|full-bleed|edge-to-edge/i.test(currentPrompt)) {
    currentPrompt = `${currentPrompt}\n\nCritical constraints: ${NO_MOCKUP_HINT}.`;
  }

  for (let i = 0; i < attempts; i++) {
    const backoff = 350 * (i + 1);

    // 1) gpt-image-1 först
    try {
      const r = await openai.images.generate({
        model: "gpt-image-1",
        prompt: currentPrompt,
        size
      });
      return r.data[0].url;
    } catch (err) {
      const msg = (err && (err.message || err.error?.message)) || "";
      const status = err?.status || err?.code;

      // Policyproblem → omskriv & retry
      if (status === 400 || /content_policy_violation|safety|not allowed/i.test(msg)) {
        currentPrompt = await rewriteForSafety(currentPrompt);
        // säkerställ att anti-mockup ligger kvar
        if (!/no mockup|no frames|full-bleed|edge-to-edge/i.test(currentPrompt)) {
          currentPrompt = `${currentPrompt}\n\nCritical constraints: ${NO_MOCKUP_HINT}.`;
        }
        await sleep(backoff);
        continue;
      }

      // Behörighetsproblem → prova DALL·E 3
      const mustVerify =
        status === 403 || /must be verified|permission|denied|not authorized/i.test(msg);

      if (!mustVerify) {
        await sleep(backoff);
      } else {
        try {
          const r2 = await openai.images.generate({
            model: "dall-e-3",
            prompt: currentPrompt,
            size,
            quality: "standard",
            response_format: "url"
          });
          return r2.data[0].url;
        } catch (err2) {
          const msg2 = (err2 && (err2.message || err2.error?.message)) || "";
          const status2 = err2?.status || err2?.code;
          if (status2 === 400 || /content_policy_violation|safety|not allowed/i.test(msg2)) {
            currentPrompt = await rewriteForSafety(currentPrompt);
            if (!/no mockup|no frames|full-bleed|edge-to-edge/i.test(currentPrompt)) {
              currentPrompt = `${currentPrompt}\n\nCritical constraints: ${NO_MOCKUP_HINT}.`;
            }
            await sleep(backoff);
          } else {
            await sleep(backoff);
          }
        }
      }
    }
  }

  // Sista försök – DALL·E 3 med omskriven prompt
  const finalPrompt = await rewriteForSafety(currentPrompt);
  const finalWithGuard = /no mockup|no frames|full-bleed|edge-to-edge/i.test(finalPrompt)
    ? finalPrompt
    : `${finalPrompt}\n\nCritical constraints: ${NO_MOCKUP_HINT}.`;

  const res = await openai.images.generate({
    model: "dall-e-3",
    prompt: finalWithGuard,
    size,
    quality: "standard",
    response_format: "url"
  });
  return res.data[0].url;
}

/* -----------------------------------------------------------
   IMG2IMG (+ valfri mask)
----------------------------------------------------------- */
/**
 * generateImageFromPromptWithInit(input, prompt, {
 *   size="1024x1024",
 *   mask: <Buffer | string (filväg)>   // valfritt: inpainting
 * })
 *
 * - Använder gpt-image-1 `images.edits` (DALL·E 3 har inte motsv. här)
 * - Tar emot Buffer eller filväg som `input`
 */
async function generateImageFromPromptWithInit(input, prompt, options = {}) {
  if (!openai?.images?.edits) {
    throw new Error("images.edits saknas i denna OpenAI-SDK/version");
  }

  const size = options.size || "1024x1024";

  // Skriv Buffer till tempfil om nödvändigt
  let tempIn = null;
  let imagePath =
    typeof input === "string"
      ? path.resolve(input)
      : (() => {
          tempIn = path.join(
            os.tmpdir(),
            `aimark-${Date.now()}-${Math.random().toString(36).slice(2)}.png`
          );
          fs.writeFileSync(tempIn, input);
          return tempIn;
        })();

  // Mask kan vara buffer eller filväg
  let tempMask = null;
  let maskPath = null;
  if (options.mask) {
    maskPath =
      typeof options.mask === "string"
        ? path.resolve(options.mask)
        : (() => {
            tempMask = path.join(
              os.tmpdir(),
              `aimark-mask-${Date.now()}-${Math.random().toString(36).slice(2)}.png`
            );
            fs.writeFileSync(tempMask, options.mask);
            return tempMask;
          })();
  }

  // Injicera anti-mockup även här
  let guardedPrompt = String(prompt || "");
  if (!/no mockup|no frames|full-bleed|edge-to-edge/i.test(guardedPrompt)) {
    guardedPrompt = `${guardedPrompt}\n\nCritical constraints: ${NO_MOCKUP_HINT}.`;
  }

  try {
    const payload = {
      model: "gpt-image-1",
      image: fs.createReadStream(imagePath),
      prompt: guardedPrompt,
      size
    };
    if (maskPath) payload.mask = fs.createReadStream(maskPath);

    const res = await openai.images.edits(payload);
    return res.data[0].url;
  } finally {
    // städa temp
    if (tempIn) fs.rm(tempIn, { force: true }, () => {});
    if (tempMask) fs.rm(tempMask, { force: true }, () => {});
  }
}

/* -----------------------------------------------------------
   Exports
----------------------------------------------------------- */
module.exports = {
  createPromptFromDescription,
  generateImageFromPrompt,
  generateImageFromPromptWithInit,
  rewriteForSafety
};
