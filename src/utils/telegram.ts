// backend/src/utils/telegram.ts
import crypto from "crypto";
import { ENV } from "../config/env.js";

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

export interface TelegramInitData {
  user: TelegramUser;
  auth_date: number;
  hash: string;
  [key: string]: any;
}

/**
 * Проверка подписи Telegram WebApp initData
 * Документация: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyTelegramWebAppData(initDataString: string): TelegramInitData {
  const params = new URLSearchParams(initDataString);
  const hash = params.get("hash");
  
  if (!hash) {
    throw new Error("Missing hash in initData");
  }
  
  // Убираем hash из параметров
  params.delete("hash");
  
  // Сортируем параметры и формируем data-check-string
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  
  // Вычисляем секретный ключ
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(ENV.BOT_TOKEN)
    .digest();
  
  // Вычисляем hash
  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  
  // Сравниваем
  if (calculatedHash !== hash) {
    throw new Error("Invalid initData signature");
  }
  
  // Проверяем auth_date (макс. 60 сек назад по умолчанию)
  const authDate = Number(params.get("auth_date") || 0);
  const now = Math.floor(Date.now() / 1000);
  
  if (Math.abs(now - authDate) > ENV.TG_INITDATA_MAX_AGE) {
    throw new Error("initData expired");
  }
  
  // Парсим user
  const userStr = params.get("user");
  if (!userStr) {
    throw new Error("Missing user in initData");
  }
  
  let user: TelegramUser;
  try {
    user = JSON.parse(userStr);
  } catch {
    throw new Error("Invalid user JSON in initData");
  }
  
  return {
    user,
    auth_date: authDate,
    hash,
  };
}