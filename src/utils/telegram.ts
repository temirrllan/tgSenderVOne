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
 * 
 * Алгоритм проверки:
 * 1. Извлекаем hash из параметров
 * 2. Формируем data-check-string (сортированные параметры без hash)
 * 3. Вычисляем secret_key = HMAC-SHA256("WebAppData", bot_token)
 * 4. Вычисляем hash = HMAC-SHA256(secret_key, data-check-string)
 * 5. Сравниваем с переданным hash
 * 6. Проверяем auth_date (не старше N секунд)
 * 
 * Документация: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyTelegramWebAppData(initDataString: string): TelegramInitData {
  console.log("🔍 [VERIFY] Start verification:", {
    length: initDataString.length,
    preview: initDataString.slice(0, 100),
  });

  // 1. Парсим параметры
  const params = new URLSearchParams(initDataString);
  const hash = params.get("hash");
  
  if (!hash) {
    throw new Error("Missing hash in initData");
  }
  
  console.log("📋 [VERIFY] Received hash:", hash);
  
  // 2. Убираем hash из параметров
  params.delete("hash");
  
  // 3. Формируем data-check-string (сортированные key=value)
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  
  console.log("📝 [VERIFY] Data check string:", {
    length: dataCheckString.length,
    preview: dataCheckString.slice(0, 100),
  });
  
  // 4. Вычисляем secret_key
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(ENV.BOT_TOKEN)
    .digest();
  
  console.log("🔑 [VERIFY] Secret key computed");
  
  // 5. Вычисляем hash
  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  
  console.log("🧮 [VERIFY] Calculated hash:", calculatedHash);
  
  // 6. Сравниваем хеши
  if (calculatedHash !== hash) {
    console.error("❌ [VERIFY] Hash mismatch:", {
      expected: hash,
      calculated: calculatedHash,
    });
    throw new Error("Invalid initData signature");
  }
  
  console.log("✅ [VERIFY] Hash match!");
  
  // 7. Проверяем auth_date (защита от replay-атак)
  const authDate = Number(params.get("auth_date") || 0);
  const now = Math.floor(Date.now() / 1000);
  const age = Math.abs(now - authDate);
  
  console.log("⏰ [VERIFY] Auth date check:", {
    authDate,
    now,
    age,
    maxAge: ENV.TG_INITDATA_MAX_AGE,
  });
  
  if (age > ENV.TG_INITDATA_MAX_AGE) {
    throw new Error(`initData expired (age: ${age}s, max: ${ENV.TG_INITDATA_MAX_AGE}s)`);
  }
  
  // 8. Парсим user
  const userStr = params.get("user");
  if (!userStr) {
    throw new Error("Missing user in initData");
  }
  
  let user: TelegramUser;
  try {
    user = JSON.parse(userStr);
    console.log("👤 [VERIFY] User parsed:", {
      id: user.id,
      username: user.username,
      firstName: user.first_name,
    });
  } catch (parseError) {
    console.error("❌ [VERIFY] Failed to parse user JSON:", parseError);
    throw new Error("Invalid user JSON in initData");
  }
  
  console.log("✅ [VERIFY] All checks passed!");
  
  return {
    user,
    auth_date: authDate,
    hash,
  };
}