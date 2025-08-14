const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Customer = require("../models/Customer");

dotenv.config();

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("🟢 Ansluten till databasen");

    const admins = await Customer.find({ role: "admin" });

    for (const admin of admins) {
      if (!admin.groupId) {
        admin.groupId = admin._id;
        await admin.save();
        console.log(`✅ Satt groupId för admin ${admin.email} → ${admin._id}`);
      } else {
        console.log(`ℹ️ Admin ${admin.email} har redan groupId`);
      }
    }

    mongoose.disconnect();
  } catch (err) {
    console.error("❌ Fel:", err);
    mongoose.disconnect();
  }
}

run();
