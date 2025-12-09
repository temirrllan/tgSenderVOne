// backend/src/scripts/create-admin.ts
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { Admin } from "../models/Admin.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGO_URL || "";

async function createAdmin() {
  try {
    console.log("🔌 Connecting to MongoDB...");
    
    await mongoose.connect(MONGO_URI, {
      dbName: "sendingBot",
    });
    
    console.log("✅ Connected to MongoDB");
    
    // Запрашиваем Telegram ID
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const question = (query: string): Promise<string> => {
      return new Promise(resolve => rl.question(query, resolve));
    };

    console.log("\n📝 Create new admin\n");
    
    const telegramIdStr = await question("Enter Telegram ID: ");
    const telegramId = Number(telegramIdStr.trim());
    
    if (!telegramId || isNaN(telegramId)) {
      console.error("❌ Invalid Telegram ID");
      rl.close();
      process.exit(1);
    }

    // Проверяем существование
    const existing = await Admin.findOne({ telegramId });
    if (existing) {
      console.log(`\n⚠️  Admin with Telegram ID ${telegramId} already exists`);
      console.log(`   Username: ${existing.username || 'N/A'}`);
      console.log(`   Role: ${existing.role}`);
      console.log(`   Active: ${existing.isActive}`);
      
      const update = await question("\nUpdate this admin? (y/n): ");
      if (update.toLowerCase() !== 'y') {
        rl.close();
        process.exit(0);
      }

      const role = await question("Enter role (superadmin/manager/support): ") as any;
      if (!['superadmin', 'manager', 'support'].includes(role)) {
        console.error("❌ Invalid role");
        rl.close();
        process.exit(1);
      }

      existing.role = role;
      existing.isActive = true;
      await existing.save();

      console.log("\n✅ Admin updated successfully!");
      console.log(`   Telegram ID: ${existing.telegramId}`);
      console.log(`   Role: ${existing.role}`);
      
      rl.close();
      process.exit(0);
    }

    // Создаём нового админа
    const role = await question("Enter role (superadmin/manager/support) [default: manager]: ") as any;
    const adminRole = ['superadmin', 'manager', 'support'].includes(role) ? role : 'manager';

    const admin = await Admin.create({
      telegramId,
      role: adminRole,
      isActive: true,
    });

    console.log("\n✅ Admin created successfully!");
    console.log(`   Telegram ID: ${admin.telegramId}`);
    console.log(`   Role: ${admin.role}`);
    console.log(`   Active: ${admin.isActive}`);
    console.log("\n📱 The admin can now login through Telegram WebApp");

    rl.close();
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await mongoose.disconnect();
    console.log("\n👋 Disconnected from MongoDB");
    process.exit(0);
  }
}

createAdmin();