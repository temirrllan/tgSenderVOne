// backend/src/scripts/make-admin.ts
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { User } from "../models/User.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGO_URL || "";

async function makeAdmin() {
  try {
    console.log("🔌 Connecting to MongoDB...");
    
    await mongoose.connect(MONGO_URI, {
      dbName: "sendingBot",
    });
    
    console.log("✅ Connected to MongoDB");
    
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const question = (query: string): Promise<string> => {
      return new Promise(resolve => rl.question(query, resolve));
    };

    console.log("\n👑 Make user an admin\n");
    
    const tgIdStr = await question("Enter Telegram ID: ");
    const tgId = Number(tgIdStr.trim());
    
    if (!tgId || isNaN(tgId)) {
      console.error("❌ Invalid Telegram ID");
      rl.close();
      process.exit(1);
    }

    // Ищем пользователя
    const user = await User.findOne({ tgId });
    
    if (!user) {
      console.log(`\n⚠️  User with Telegram ID ${tgId} not found`);
      console.log("   User must register in the bot first!");
      rl.close();
      process.exit(1);
    }

    console.log(`\n📋 User found:`);
    console.log(`   Username: @${user.username || 'N/A'}`);
    console.log(`   Name: ${user.firstName || ''} ${user.lastName || ''}`);
    console.log(`   Current admin status: ${user.isAdmin ? 'YES ✅' : 'NO ❌'}`);

    if (user.isAdmin) {
      const revoke = await question("\n❓ This user is already an admin. Revoke admin rights? (y/n): ");
      if (revoke.toLowerCase() === 'y') {
        user.isAdmin = false;
        await user.save();
        console.log("\n✅ Admin rights revoked!");
      } else {
        console.log("\n👋 No changes made");
      }
    } else {
      const confirm = await question("\n❓ Make this user an admin? (y/n): ");
      if (confirm.toLowerCase() === 'y') {
        user.isAdmin = true;
        await user.save();
        console.log("\n✅ User is now an admin!");
      } else {
        console.log("\n👋 No changes made");
      }
    }

    console.log(`\n📊 Final status:`);
    console.log(`   Telegram ID: ${user.tgId}`);
    console.log(`   Username: @${user.username || 'N/A'}`);
    console.log(`   Is Admin: ${user.isAdmin ? 'YES ✅' : 'NO ❌'}`);

    rl.close();
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await mongoose.disconnect();
    console.log("\n👋 Disconnected from MongoDB");
    process.exit(0);
  }
}

makeAdmin();