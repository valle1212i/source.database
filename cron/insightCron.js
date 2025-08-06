const cron = require('node-cron');
const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const Customer = require('../models/Customer');
const Insight = require('../models/Insight'); // ✅ Lägg till detta

function generatePrompt(customer) {
  return [
    {
      role: "system",
      content: `
Du är en expert inom e-handelstillväxt och digital marknadsföring.
Generera konkreta, mätbara och personliga tillväxttips i JSON-format.
Fokusera på kanalval, målsättningar, kampanjaktivitet och bransch.
      `
    },
    {
      role: "user",
      content: `Här är kundens data:\n\n${JSON.stringify(customer)}`
    }
  ];
}

async function generateInsightsForAllCustomers() {
  try {
    const customers = await Customer.find({}).lean();

    for (const customer of customers) {
      const messages = generatePrompt(customer);

      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages,
        temperature: 0.7
      });

      const insightsRaw = completion.choices[0].message.content;

      let insights;
      try {
        insights = JSON.parse(insightsRaw);
      } catch (err) {
        console.warn(`⚠️ Kunde inte tolka AI-svar för ${customer.name}:`, insightsRaw);
        continue;
      }

      // 💾 Rensa gamla insikter först (om du vill)
      await Insight.deleteMany({ customerId: customer._id });

      // 💾 Spara nya insikter
      for (const tip of insights) {
        await Insight.create({
          customerId: customer._id,
          ...tip
        });
      }

      console.log(`✅ Sparade ${insights.length} insikter för ${customer.name}`);
    }
  } catch (err) {
    console.error("❌ Cron-fel:", err);
  }
}

// 🕓 Kör varje dag kl. 03:00
cron.schedule('0 3 * * *', () => {
  console.log("⏰ Startar daglig AI-insiktsgenerering...");
  generateInsightsForAllCustomers();
});

module.exports = { generateInsightsForAllCustomers };
