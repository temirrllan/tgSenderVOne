// src/index.ts
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import engine from "ejs-mate";
import path from "path";
import mongoose from "mongoose";
import cron from "node-cron";
import dotenv from "dotenv";
import morgan from "morgan";
import helmet from "helmet";

import bot from "./tgBot/bot.js";
import router from "./routes/router.js";

dotenv.config();

const app = express();
// PORT может быть строкой в env — приводим к number
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

/**
 * ------------------------
 *  Изменения и пояснения
 * ------------------------
 * 1) Перевёл старт приложения в async-функцию start() — чтобы гарантированно:
 *    - дождаться подключения к БД
 *    - дождаться старта HTTP-сервера до .launch() бота (или наоборот, по желанию)
 * 2) Добавил morgan для логирования HTTP-запросов (удобно при разработке).
 * 3) Добавил helmet — базовые заголовки безопасности.
 * 4) Добавил CORS с возможностью задать FRONTEND_URL в .env (для dev/прод).
 * 5) Включил централизованный обработчик ошибок для express.
 * 6) Корректный graceful shutdown: останавливаем бот и закрываем соединение с Mongo.
 * 7) Немного переструктурировал порядок middlewares (json/urlencoded/ статические файлы и т.д.).
 */

/* -- Настройки middlewares -- */
app.use(helmet()); // базовые безопасные заголовки
// CORS: по умолчанию разрешаем всё в dev, но можно указать FRONTEND_URL в .env
const FRONTEND_URL = process.env.FRONTEND_URL || "";
if (FRONTEND_URL) {
  app.use(
    cors({
      origin: FRONTEND_URL,
      credentials: true,
    })
  );
} else {
  // dev fallback — разрешаем всё (можно сузить)
  app.use(cors());
}

app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static("public"));

/* -- View engine (admin pages) -- */
app.engine("ejs", engine);
app.set("view engine", "ejs");
app.set("views", path.resolve("views"));

/* -- MongoDB connection -- */
const uri = process.env.MONGO_URI || "";
if (!uri) {
  console.error("MONGO_URI is not defined in the environment variables!");
  process.exit(1);
}

/**
 * connectToDatabase() — теперь возвращает promise и бросает ошибку при провале.
 * Мы используем dbName 'sendingBot' как у тебя — оставил.
 */
async function connectToDatabase() {
  try {
    await mongoose.connect(uri, { dbName: "sendingBot" });
    console.log("Connected to db");
  } catch (err) {
    console.error("Error connecting to the database:", err);
    throw err;
  }
}

/* -- Router mount (api + admin and so on) -- */
app.use("/", router);

/* -- Health check (полезно для k8s / мониторинга) -- */
app.get("/health", (req, res) => {
  return res.status(200).json({ ok: true, uptime: process.uptime() });
});

/* -- Central error handler (express) -- */
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Unhandled express error:", err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: "internal_error", message: err.message || String(err) });
});

/* -- Graceful shutdown helpers -- */
let serverInstance: any = null;

async function gracefulShutdown(signal?: string) {
  console.log("Graceful shutdown initiated", signal || "");
  try {
    // stop Telegram bot if running
    try {
      await bot.stop();
      console.log("Telegram bot stopped");
    } catch (e) {
      console.warn("Error stopping bot gracefully:", e);
    }

    // close HTTP server
    if (serverInstance) {
      await new Promise((resolve, reject) => {
        serverInstance.close((err: any) => {
          if (err) return reject(err);
          resolve(null);
        });
      });
      console.log("HTTP server closed");
    }

    // close mongoose connection
    try {
      await mongoose.connection.close();
      console.log("Mongo connection closed");
    } catch (e) {
      console.warn("Error closing Mongo connection:", e);
    }

    process.exit(0);
  } catch (e) {
    console.error("Error during graceful shutdown:", e);
    process.exit(1);
  }
}

/* -- Start sequence: сначала DB, затем сервер, затем бот -- */
async function start() {
  try {
    // 1) Подключаемся к БД
    await connectToDatabase();

    // 2) Запускаем HTTP-сервер
    serverInstance = app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}, http://localhost:${PORT}`);
    });

    // 3) Запускаем Telegram Bot (подождёт готовности сервера)
    //    Если хочешь запускать бот до сервера — поменяй порядок.
    try {
      await bot.launch();
      console.log("Bot started");
    } catch (err) {
      console.error("Failed to start bot:", err);
      // если бот не запустился, можно решать: завершить процесс или продолжить; сейчас завершаем.
      throw err;
    }

    // 4) Optional: Cron jobs (если нужны) — пример:
    // cron.schedule('* * * * *', () => { console.log('tick every minute'); });

    // Обрабатываем сигналы ОС
    process.once("SIGINT", () => gracefulShutdown("SIGINT"));
    process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));

    // Обрабатываем необработанные ошибки/отклонения промисов
    process.on("unhandledRejection", (reason) => {
      console.error("Unhandled Rejection at:", reason);
    });
    process.on("uncaughtException", (err) => {
      console.error("Uncaught Exception thrown:", err);
      // в случае uncaught лучше завершить процесс
      gracefulShutdown("uncaughtException");
    });
  } catch (err) {
    console.error("Failed to start application:", err);
    process.exit(1);
  }
}

/* Запускаем всё */
start();
