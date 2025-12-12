// backend/src/config/env.ts
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number(process.env.PORT) || 3000,
  
  // MongoDB
  MONGO_URI: process.env.MONGO_URI || process.env.MONGO_URL || "",
  
  // Telegram Bot
  BOT_TOKEN: process.env.BOT_TOKEN || "",
  MAIN_BOT_USERNAME: (process.env.MAIN_BOT_USERNAME || process.env.BOT_USERNAME || "").replace(/^@/, ""),
  
  // Telegram API (для создания аккаунтов)
  TELEGRAM_API_ID: process.env.TELEGRAM_API_ID || "",
  TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH || "",
  
  // Plivo (для покупки номеров)
  PLIVO_AUTH_ID: process.env.PLIVO_AUTH_ID || "",
  PLIVO_AUTH_TOKEN: process.env.PLIVO_AUTH_TOKEN || "",
  
  // JWT
  JWT_SECRET: process.env.JWT_SECRET || "change_me_secret",
  JWT_TTL: process.env.JWT_TTL || "30d",
  
  // Crypto Payment
  CRYPTO_WALLET: process.env.CRYPTO_WALLET || "",
  ACCESS_PRICE: process.env.ACCESS_PRICE || "10",
  ACCESS_CURRENCY: process.env.ACCESS_CURRENCY || "USDT",
  BOT_PRICE: Number(process.env.BOT_PRICE) || 5,
  BOT_CURRENCY: process.env.BOT_CURRENCY || "USDT",
  
  // Mini App
  MINIAPP_URL: process.env.MINIAPP_URL || "",
  
  // Telegram Init Data
  TG_INITDATA_MAX_AGE: Number(process.env.TG_INITDATA_MAX_AGE) || 60,
  
  // Cookie
  AUTH_COOKIE: process.env.AUTH_COOKIE || "token",
  COMPANY_NAME: process.env.COMPANY_NAME || "Sender",
} as const;

// Валидация критичных переменных
const required = [
  "MONGO_URI", 
  "BOT_TOKEN", 
  "MAIN_BOT_USERNAME", 
  "JWT_SECRET",
  "TELEGRAM_API_ID",
  "TELEGRAM_API_HASH",
  "PLIVO_AUTH_ID",
  "PLIVO_AUTH_TOKEN",
];

const missing = required.filter(key => !ENV[key as keyof typeof ENV]);

if (missing.length > 0) {
  console.error(`❌ Missing required env vars: ${missing.join(", ")}`);
  
  // В development режиме только предупреждаем
  if (ENV.NODE_ENV === "production") {
    process.exit(1);
  } else {
    console.warn("⚠️  Running in development mode with missing credentials");
  }
}

export const isDev = ENV.NODE_ENV === "development";
export const isProd = ENV.NODE_ENV === "production";