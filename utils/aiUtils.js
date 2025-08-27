// utils/aiUtils.js
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ---------- små helpers ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Omskriv prompt till en policy‑vänlig variant (tar bort varumärken, förbjuden text, etc)
 * men behåller den kommersiella intentionen.
 */
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
            "Rewrite the user's text into a policy-safe prompt for a commercial, royalty-free image. Remove third-party brand names and sensitive content. Keep the marketing intent and scene description. Respond only with the rewritten English text.",
        },
        {
          role: "user",
          content: String(original || ""),
        },
      ],
    });
    const text = completion?.choices?.[0]?.message?.content?.trim();
    return text || original;
  } catch {
    return original;
  }
}

/**
 * Kort basprompt via LLM – fokuserar på annons/affisch (SoMe‑redo).
 * Exponerar options ifall du vill styra stilen från routern framöver.
 */
async function createPromptFromDescription(description, opts = {}) {
  const {
    tone = "modern, premium, high-contrast",
    style = "photorealistic, studio lighting, clean gradients, minimal artifacts",
    aspectRatio = "1080x1350",
  } = opts;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.5,
    max_tokens: 160,
    messages: [
      {
        role: "system",
        content:
          "You write concise, visual prompts for AI image generation focused on professional marketing posters and social ads. Always reply in English.",
      },
      {
        role: "user",
        content:
          `Turn this idea into a short, vivid image prompt for a commercial, royalty-free visual:
---
${description || "N/A"}
---
Target: professional ad/poster (social media ready).
Tone: ${tone}.
Style: ${style}.
Aspect ratio: ${aspectRatio}.
Avoid third-party brand logos or watermarks. Keep text minimal unless explicitly provided.`,
      },
    ],
  });

  return completion.choices?.[0]?.message?.content?.trim() || "";
}

/**
 * TEXT → BILD med robusta fallbacks:
 * 1) Försök gpt-image-1
 * 2) Vid 400 (content policy) eller 403 (permission) → omskriv +/eller fall back till DALL·E 3
 * 3) Retrier med exponential backoff
 *
 * options:
 *  - size: "1024x1024" | "1024x1792" | "1792x1024" (default "1024x1024")
 *  - attempts: antal försök totalt (default 3)
 */
async function generateImageFromPrompt(prompt, options = {}) {
  const size = options.size || "1024x1024";
  const attempts = Math.max(1, options.attempts || 3);

  let currentPrompt = String(prompt || "");

  for (let i = 0; i < attempts; i++) {
    const backoff = 350 * (i + 1);

    // 1) gpt-image-1 först
    try {
      const r = await openai.images.generate({
        model: "gpt-image-1",
        prompt: currentPrompt,
        size,
      });
      return r.data[0].url;
    } catch (err) {
      const msg = (err && (err.message || err.error?.message)) || "";
      const status = err?.status || err?.code;

      // Policyproblem → försök policy‑vänlig omskrivning
      if (
        status === 400 ||
        /content_policy_violation|safety|not allowed/i.test(msg)
      ) {
        currentPrompt = await rewriteForSafety(currentPrompt);
        await sleep(backoff);
        // prova igen i nästa loop (vi försöker fortfarande gpt-image-1 först)
        continue;
      }

      // Behörighet/verify → gå direkt till DALL·E 3
      const mustVerify =
        status === 403 || /must be verified|permission|denied|not authorized/i.test(msg);

      if (!mustVerify) {
        // Transienta fel → vänta och försök igen
        await sleep(backoff);
      } else {
        // 2) Fallback till DALL·E 3
        try {
          const r2 = await openai.images.generate({
            model: "dall-e-3",
            prompt: currentPrompt,
            size,
            quality: "standard",
            response_format: "url",
          });
          return r2.data[0].url;
        } catch (err2) {
          const msg2 = (err2 && (err2.message || err2.error?.message)) || "";
          const status2 = err2?.status || err2?.code;

          if (
            status2 === 400 ||
            /content_policy_violation|safety|not allowed/i.test(msg2)
          ) {
            currentPrompt = await rewriteForSafety(currentPrompt);
            await sleep(backoff);
            // låt loopen fortsätta (vi försöker igen)
          } else {
            await sleep(backoff);
          }
        }
      }
    }
  }

  // Sista försök – DALL·E 3 med omskriven prompt
  const finalPrompt = await rewriteForSafety(currentPrompt);
  const res = await openai.images.generate({
    model: "dall-e-3",
    prompt: finalPrompt,
    size,
    quality: "standard",
    response_format: "url",
  });
  return res.data[0].url;
}

/**
 * IMG2IMG – används bara om ditt konto/SDK har stöd.
 * Routern fångar felet och faller tillbaka till bakgrund+komposition.
 */
async function generateImageFromPromptWithInit(filePath, prompt, options = {}) {
  if (!openai?.images?.edits) {
    throw new Error("images.edits saknas i denna OpenAI‑SDK/version");
  }
  const size = options.size || "1024x1024";
  const res = await openai.images.edits({
    model: "gpt-image-1",
    image: fs.createReadStream(path.resolve(filePath)),
    prompt,
    size,
  });
  return res.data[0].url;
}

module.exports = {
  createPromptFromDescription,
  generateImageFromPrompt,
  generateImageFromPromptWithInit,
  rewriteForSafety, // exporteras om du vill logga/testa
};
