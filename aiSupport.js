const OpenAI = require("openai");

async function handleCustomerQuestion(user, message) {
  console.log("💬 GPT-fråga:", message);
  console.log("🧠 Användardata:", user);

  const name = user.name || "Okänt företag";
  const industry = user.industry || "Ingen bransch angiven";
  const website = user.website || "Ingen webbadress";
  const campaigns = Array.isArray(user.campaigns)
    ? user.campaigns.join(', ')
    : user.campaigns || "Inga kampanjer";

  const context = `
    Företagsnamn: ${name}
    Bransch: ${industry}
    Webbplats: ${website}
    Aktiva kampanjer: ${campaigns}
  `;

  const prompt = `
    Du är en AI-assistent för ett e-handelsföretag.
    Följande är information om deras verksamhet:
    ${context}

    Fråga: ${message}
    Svara tydligt och kortfattat. Kunden kan skriva på vilket språk som helst – på det språket som frågan ställs på.
  `;

  const openai = new OpenAI();
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "Du är en hjälpsam AI-agent för e-handlare." },
      { role: "user", content: prompt }
    ]
  });

  return response.choices[0].message.content;
}

module.exports = { handleCustomerQuestion };
