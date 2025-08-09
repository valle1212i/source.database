const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Skapar en visuell prompt från en beskrivning via GPT-4
 */
async function createPromptFromDescription(description) {
  const messages = [
    {
      role: "system",
      content: "Du är en expert på att skapa korta och visuellt beskrivande prompts för AI-bildgenerering. Skriv alltid på engelska.",
    },
    {
      role: "user",
      content: `Skapa en kort prompt för en AI-bild baserat på denna beskrivning: "${description}"`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4",
    messages,
    temperature: 0.7,
    max_tokens: 100,
  });

  return completion.choices[0].message.content.trim();
}

/**
 * Genererar en bild med DALL·E 3 från prompten
 */
async function generateImageFromPrompt(prompt) {
  const response = await openai.images.generate({
    model: "dall-e-3", // Viktigt: använd DALL·E 3 för bästa kvalitet
    prompt: prompt,
    n: 1,
    size: "1024x1024",
    quality: "standard",
    response_format: "url",
  });

  return response.data[0].url;
}

module.exports = {
  createPromptFromDescription,
  generateImageFromPrompt,
};
