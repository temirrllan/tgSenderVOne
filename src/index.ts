// backend/src/index.ts
import express from "express";
import cookieParser from "cookie-parser";
import engine from "ejs-mate";
import path from "path";
import morgan from "morgan";
import helmet from "helmet";

import { ENV, isDev } from "./config/env.js";
import { connectDatabase } from "./config/database.js";

import bot from "./tgBot/bot.js";
import router from "./routes/router.js";
import apiRouter from "./routes/api.js";
import phoneRouter from "./routes/phone.js"; // ✅ Новый роут
import { setupCronJobs } from "./scripts/process-payments.js"; // ✅ Крон для платежей

const app = express();

/**
 * CORS
 */
app.use((req, res, next) => {
  const allowedOrigins = [
    "https://web.telegram.org",
    "https://telegram.org", 
    "https://sendler-bot-front.vercel.app",
  ];
  
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
  }
  
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
 * Middleware
 */
app.use(helmet());
app.use(morgan(isDev ? "dev" : "combined"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static("public"));

/**
 * View engine (EJS)
 */
app.engine("ejs", engine);
app.set("view engine", "ejs");
app.set("views", path.resolve("views"));

/**
 * MongoDB connection
 */
connectDatabase();

/**
 * API Routes
 */
app.use("/api", (req, _res, next) => {
  console.log("🔥 API HIT:", req.method, req.originalUrl);
  next();
});

app.use("/api", apiRouter);
app.use("/api/phone", phoneRouter); // ✅ Роуты для номеров и платежей
app.use("/", router);

/**
 * Health check
 */
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, uptime: process.uptime() });
});

/**
 * Error handler
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
 * Start server
 */
app.listen(ENV.PORT, async () => {
  console.log(`🚀 Server running on port ${ENV.PORT}`);
  console.log(`📍 Environment: ${ENV.NODE_ENV}`);
  
  // ✅ Запускаем крон для автоматической обработки платежей
  if (ENV.NODE_ENV === 'production') {
    await setupCronJobs();
    console.log('✅ Payment processing cron started');
  }
});

// Telegram Bot launcher
bot.launch().then(() => console.log("🤖 Telegram bot started"));