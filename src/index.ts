import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import engine from "ejs-mate";
import path from "path";
import mongoose from "mongoose";
import cron from "node-cron";
import dotenv from "dotenv";
import bot from "./tgBot/bot.js";
import router from "./routes/router.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- Express настройки ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static("public"));
app.engine("ejs", engine);
app.set("view engine", "ejs");
app.set("views", path.resolve("views"));

// --- Mongo ---
const uri = process.env.MONGO_URI || "";
if (!uri) {
  console.error("MONGO_URI is not defined in the environment variables!");
  process.exit(1);
}
async function connectToDatabase() {
  try {
    await mongoose.connect(uri, { dbName: "sendingBot" });
    console.log("Connected to db");
  } catch (err) {
    console.error("Error connecting to the database:", err);
    process.exit(1);
  }
}
connectToDatabase();

app.use("/", router);

// --- Express server ---
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}, http://localhost:${PORT}`);
});

// --- Telegram Bot ---
bot
  .launch()
  .then(() => {
    console.log("Bot started");
  })
  .catch((err: unknown) => {
    console.error("Failed to start bot:", err);
  });

// Graceful stop (Heroku / Docker / PM2 и пр.)
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
