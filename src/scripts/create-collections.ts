// scripts/create-collections.ts
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

// Загружаем .env
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGO_URL || "";

async function createCollections() {
  try {
    console.log("🔌 Connecting to MongoDB...");
    
    await mongoose.connect(MONGO_URI, {
      dbName: "sendingBot",
    });
    
    console.log("✅ Connected to MongoDB");
    
    const db = mongoose.connection.db!;
    
    // Проверяем существующие коллекции
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    console.log("\n📋 Existing collections:", collectionNames);
    
    // Создаём deleted_bots если её нет
    if (!collectionNames.includes("deleted_bots")) {
      await db.createCollection("deleted_bots");
      console.log("✅ Created collection: deleted_bots");
      
      // Создаём индексы
      await db.collection("deleted_bots").createIndexes([
        { key: { owner: 1, deletedAt: -1 } },
        { key: { deletedBy: 1, deletedAt: -1 } },
        { key: { deletedAt: -1 } },
        { key: { originalBotId: 1 } },
        { key: { ownerTgId: 1 } },  // ✅ Индекс по tgId владельца
        { key: { deletedByTgId: 1 } },  // ✅ Индекс по tgId удалившего
      ]);
      
      console.log("✅ Created indexes for deleted_bots");
    } else {
      console.log("ℹ️  Collection deleted_bots already exists");
    }
    
    // Показываем финальный список
    const finalCollections = await db.listCollections().toArray();
    console.log("\n📋 Final collections:");
    finalCollections.forEach(c => {
      console.log(`  - ${c.name}`);
    });
    
    console.log("\n✅ Done!");
    
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await mongoose.disconnect();
    console.log("👋 Disconnected from MongoDB");
    process.exit(0);
  }
}

createCollections();