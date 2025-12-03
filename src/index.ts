// src/index.ts
import express from "express";
import cookieParser from "cookie-parser";
// import cors from "cors"; // не нужен, CORS делаем вручную
import engine from "ejs-mate";
import path from "path";
import mongoose from "mongoose";
import dotenv from "dotenv";
import morgan from "morgan";
import helmet from "helmet";

import bot from "./tgBot/bot.js";
import router from "./routes/router.js";
import apiRouter from "./routes/api.js"; // API роуты

dotenv.config();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

/**
 * -----------------------------------
 *  🛑 CORS — СТАВИМ ПЕРВЫМ!
 * -----------------------------------
 */
app.use((req, res, next) => {
  console.log("CORS middleware:", req.method, req.path);

  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, ngrok-skip-browser-warning"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});


/**
 * -----------------------------------
 *  Общие middleware
 * -----------------------------------
 */
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static("public"));

/**
 * -----------------------------------
 *  View engine (EJS)
 * -----------------------------------
 */
app.engine("ejs", engine);
app.set("view engine", "ejs");
app.set("views", path.resolve("views"));

/**
 * -----------------------------------
 *  MongoDB connection
 * -----------------------------------
 */
const uri = process.env.MONGO_URI || "";
if (!uri) {
  console.error("❌ MONGO_URI is not defined in env!");
  process.exit(1);
}

async function connectToDatabase() {
  try {
    await mongoose.connect(uri, { dbName: "sendingBot" });
    console.log("✅ Connected to DB");
  } catch (err) {
    console.error("❌ DB connection error:", err);
    throw err;
  }
}
connectToDatabase();

/**
 * -----------------------------------
 *  API РОУТЫ — СТАВИМ ПЕРЕД ОСНОВНЫМИ
 * -----------------------------------
 */

// Лог, чтобы убедиться, что API работает
app.use("/api", (req, _res, next) => {
  console.log("🔥 API HIT:", req.method, req.originalUrl);
  next();
});

// Подключаем твой API
app.use("/api", apiRouter);

/**
 * -----------------------------------
 *  Основные роуты сайта / админка
 * -----------------------------------
 */
app.use("/", router);

/**
 * -----------------------------------
 *  Health-check
 * -----------------------------------
 */
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, uptime: process.uptime() });
});

/**
 * -----------------------------------
 *  CENTRAL ERROR HANDLER
 * -----------------------------------
 */
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("❌ Unhandled express error:", err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({
    error: "internal_error",
    message: err.message || String(err),
  });
});

/**
 * -----------------------------------
 *  START SERVER
 * -----------------------------------
 */
let serverInstance: any = null;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  serverInstance = app;
});

// Telegram Bot launcher
bot.launch().then(() => console.log("🤖 Telegram bot started"));
