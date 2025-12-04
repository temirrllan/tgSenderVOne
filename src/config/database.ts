import mongoose from "mongoose";
import { ENV } from "./env.js";

export async function connectDatabase() {
  try {
    mongoose.set("strictQuery", true);
    
    await mongoose.connect(ENV.MONGO_URI, {
      dbName: "sendingBot",
    });
    
    console.log("✅ MongoDB connected");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
}

// Обработка отключения
mongoose.connection.on("disconnected", () => {
  console.warn("⚠️ MongoDB disconnected");
});

process.on("SIGINT", async () => {
  await mongoose.connection.close();
  process.exit(0);
});