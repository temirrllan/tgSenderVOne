// backend/src/scripts/add-balance-field.ts
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { User } from "../models/User.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGO_URL || "";

async function addBalanceField() {
  try {
    console.log("🔌 Connecting to MongoDB...");
    
    await mongoose.connect(MONGO_URI, {
      dbName: "sendingBot",
    });
    
    console.log("✅ Connected to MongoDB");
    
    // Обновляем всех пользователей без поля balance
    const result = await User.updateMany(
      { balance: { $exists: false } },
      { $set: { balance: 0 } }
    );
    
    console.log(`✅ Updated ${result.modifiedCount} users with balance field`);
    
    // Показываем статистику
    const totalUsers = await User.countDocuments();
    const usersWithBalance = await User.countDocuments({ balance: { $gte: 0 } });
    
    console.log("\n📊 Statistics:");
    console.log(`   Total users: ${totalUsers}`);
    console.log(`   Users with balance field: ${usersWithBalance}`);
    
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await mongoose.disconnect();
    console.log("\n👋 Disconnected from MongoDB");
    process.exit(0);
  }
}

addBalanceField();