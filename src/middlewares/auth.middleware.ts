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
    console.log("🔐 [AUTH MIDDLEWARE] Start:", {
      method: req.method,
      url: req.originalUrl,
      hasAuthHeader: !!req.headers.authorization,
      authPreview: req.headers.authorization?.slice(0, 30)
    });

    // 1️⃣ Получаем Authorization header
    const authHeader = req.headers.authorization || "";
    
    if (!authHeader) {
      console.error("❌ [AUTH] Missing Authorization header");
      return res.status(401).json({
        success: false,
        data: { message: "Missing Authorization header" },
      });
    }
    
let tgId: number;
let tgUser: any = {};
    
    // 2️⃣ Production: декодируем base64 и проверяем подпись
   try {
      const initDataString = Buffer.from(authHeader, "base64").toString("utf-8");
      
      console.log("🔓 [AUTH] Decoded initData:", {
        length: initDataString.length,
        preview: initDataString.slice(0, 100)
      });
      
      // Проверяем подпись Telegram
      const verified = verifyTelegramWebAppData(initDataString);
      
      tgId = verified.user.id;
      tgUser = verified.user;
      
      console.log("✅ [AUTH] Telegram signature verified:", { 
        tgId, 
        username: tgUser.username,
        firstName: tgUser.first_name
      });
    } catch (verifyError) {
            console.error("❌ [AUTH] Signature verification failed:", verifyError);

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
            console.log("📝 [AUTH] Creating new user...");

      // Автосоздание при первом входе
      user = await User.create({
        tgId,
        username: tgUser.username || "",
        firstName: tgUser.first_name || "",
        lastName: tgUser.last_name || "",
        avatarUrl: tgUser.photo_url || "",
      });
      console.log("✅ [AUTH] New user created:", { tgId, username: user.username });
    } 
    
    // 5️⃣ Прикрепляем к req и res.locals
    req.user = user;
    req.tgUser = tgUser;
    res.locals.user = user;
        console.log("✅ [AUTH] Middleware passed, user attached");

    next();
  } catch (error) {
    console.error("❌ Auth middleware error:", error);
    return res.status(500).json({
      success: false,
      data: { message: "Internal server error" },
    });
  }
}