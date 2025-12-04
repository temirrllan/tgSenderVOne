// backend/src/middlewares/auth.middleware.ts
import type { Request, Response, NextFunction } from "express";
import { User } from "../models/index.js";
import { verifyTelegramWebAppData } from "../utils/telegram.js";
import { isDev } from "../config/env.js";

export interface AuthRequest extends Request {
  user?: any;
  tgUser?: any;
}

/**
 * Middleware авторизации через Telegram WebApp initData
 * Production: проверяет подпись Telegram
 * Development: fallback на статичный tgId для тестов
 */
export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    // 1️⃣ Получаем Authorization header
    const authHeader = req.headers.authorization || "";
    
    if (!authHeader) {
  return res.status(401).json({
    success: false,
    data: { message: "Missing Authorization header" },
  });
}
    
let tgId: number;
let tgUser: any = {};
    
    // 2️⃣ Production: декодируем base64 и проверяем подпись
    try {
  // Декодируем base64 -> initData строка
  const initDataString = Buffer.from(authHeader, "base64").toString("utf-8");
  
  console.log("🔍 Auth middleware:", {
    authHeaderPreview: authHeader.slice(0, 30) + "...",
    initDataPreview: initDataString.slice(0, 100) + "...",
  });
  
  // Проверяем подпись Telegram
  const verified = verifyTelegramWebAppData(initDataString);
  
  tgId = verified.user.id;
  tgUser = verified.user;
  
  console.log("✅ Auth: Telegram signature verified", { tgId, username: tgUser.username });
} catch (verifyError) {
      // 3️⃣ Development fallback: разрешаем статичный tgId БЕЗ проверки подписи
      if (isDev) {
        console.warn("⚠️ Dev mode fallback...");
        console.warn("⚠️ Auth: Signature verification failed, using dev fallback");
        
        try {
          const initDataString = Buffer.from(authHeader, "base64").toString("utf-8");
          const params = new URLSearchParams(initDataString);
          const userStr = params.get("user");
          
          if (userStr) {
            const parsed = JSON.parse(userStr);
            tgId = parsed.id;
            tgUser = parsed;
            console.log("🛠️ Dev mode: using tgId without signature check", { tgId });
          } else {
            throw new Error("No user in initData");
          }
        } catch {
          return res.status(401).json({
            success: false,
            data: { message: "Invalid initData format" },
          });
        }
      } else {
        // Production: отклоняем невалидные данные
        return res.status(401).json({
          success: false,
          data: { message: "Invalid Telegram signature" },
        });
      }
    }
    
    // 4️⃣ Ищем/создаём пользователя в БД
    let user = await User.findOne({ tgId }).exec();
    
    if (!user) {
      // Автосоздание при первом входе
      user = await User.create({
        tgId,
        username: tgUser.username || "",
        firstName: tgUser.first_name || "",
        lastName: tgUser.last_name || "",
        avatarUrl: tgUser.photo_url || "",
      });
      console.log("📝 Created new user:", { tgId, username: user.username });
    } else {
      // Обновляем актуальные данные из Telegram
      let needSave = false;
      
      if (tgUser.username && tgUser.username !== user.username) {
        user.username = tgUser.username;
        needSave = true;
      }
      if (tgUser.first_name && tgUser.first_name !== user.firstName) {
        user.firstName = tgUser.first_name;
        needSave = true;
      }
      if (tgUser.last_name && tgUser.last_name !== user.lastName) {
        user.lastName = tgUser.last_name;
        needSave = true;
      }
      
      // Аватар обновляем ТОЛЬКО если в БД пусто
      const hasAvatarInDb = typeof user.avatarUrl === "string" && user.avatarUrl.trim().length > 0;
      const tgPhotoUrl = typeof tgUser.photo_url === "string" ? tgUser.photo_url.trim() : "";
      
      if (!hasAvatarInDb && tgPhotoUrl) {
        user.avatarUrl = tgPhotoUrl;
        needSave = true;
      }
      
      if (needSave) {
        await user.save();
      }
    }
    
    // 5️⃣ Прикрепляем к req и res.locals
    req.user = user;
    req.tgUser = tgUser;
    res.locals.user = user;
    
    next();
  } catch (error) {
    console.error("❌ Auth middleware error:", error);
    return res.status(500).json({
      success: false,
      data: { message: "Internal server error" },
    });
  }
}