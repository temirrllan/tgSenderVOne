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
 * 
 * Проверяет:
 * 1. Наличие Authorization header
 * 2. Валидность подписи Telegram (production)
 * 3. Существование пользователя в БД
 * 
 * Production: строгая проверка подписи
 * Development: fallback на статичный tgId для тестов
 */
export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    console.log("🔐 [AUTH] Start:", {
      method: req.method,
      url: req.originalUrl,
      hasAuth: !!req.headers.authorization,
    });

    // 1️⃣ Проверяем наличие Authorization header
    const authHeader = req.headers.authorization || "";
    
    if (!authHeader) {
      console.error("❌ [AUTH] Missing Authorization header");
      return res.status(401).json({
        success: false,
        error: "unauthorized",
        message: "Missing Authorization header",
      });
    }
    
    let telegramUserId: number;
    let telegramUse: any = {};
    
    // 2️⃣ Декодируем base64 → initData string
    let initDataString: string;
    try {
      initDataString = Buffer.from(authHeader, "base64").toString("utf-8");
      
      console.log("🔓 [AUTH] Decoded initData:", {
        length: initDataString.length,
        preview: initDataString.slice(0, 100),
      });
    } catch (decodeError) {
      console.error("❌ [AUTH] Failed to decode base64:", decodeError);
      return res.status(401).json({
        success: false,
        error: "invalid_auth_format",
        message: "Invalid Authorization format",
      });
    }
    
    // 3️⃣ Production: проверяем подпись Telegram
    try {
      const verified = verifyTelegramWebAppData(initDataString);
      
      telegramUserId = verified.user.id;
      telegramUse = verified.user;
      
      console.log("✅ [AUTH] Telegram signature verified:", { 
        telegramUserId, 
        username: telegramUse.username,
        firstName: telegramUse.first_name,
      });
    } catch (verifyError) {
      console.error("❌ [AUTH] Signature verification failed:", verifyError);

      // Development fallback: разрешаем без проверки подписи
      if (isDev) {
        console.warn("⚠️ [DEV MODE] Using fallback without signature check");
        
        try {
          const params = new URLSearchParams(initDataString);
          const userStr = params.get("user");
          
          if (userStr) {
            const parsed = JSON.parse(userStr);
            telegramUserId = parsed.id;
            telegramUse = parsed;
            console.log("🛠️ [DEV] Using tgId without signature:", { telegramUserId });
          } else {
            throw new Error("No user in initData");
          }
        } catch (parseError) {
          return res.status(401).json({
            success: false,
            error: "invalid_init_data",
            message: "Invalid initData format",
          });
        }
      } else {
        // Production: отклоняем невалидные данные
        return res.status(401).json({
          success: false,
          error: "invalid_signature",
          message: "Invalid Telegram signature",
        });
      }
    }
    
    // 4️⃣ Ищем пользователя в БД
    let user = await User.findOne({ telegramUserId }).exec();
    
    if (!user) {
      console.log("📝 [AUTH] User not found, creating new user...");

      // Автосоздание при первом входе
      user = await User.create({
        telegramUserId,
        username: telegramUse.username || "",
        firstName: telegramUse.first_name || "",
        lastName: telegramUse.last_name || "",
        avatarUrl: telegramUse.photo_url || "",
      });
      
      console.log("✅ [AUTH] New user created:", { 
        telegramUserId, 
        username: user.username,
      });
    } else {
      // Обновляем данные пользователя из Telegram
      let needSave = false;

      if (telegramUse.username && telegramUse.username !== user.username) {
        user.username = telegramUse.username;
        needSave = true;
      }

      if (telegramUse.first_name && telegramUse.first_name !== user.firstName) {
        user.firstName = telegramUse.first_name;
        needSave = true;
      }

      if (telegramUse.last_name && telegramUse.last_name !== user.lastName) {
        user.lastName = telegramUse.last_name;
        needSave = true;
      }

      // Аватар: обновляем только если в БД пусто
      const hasAvatarInDb = typeof (user as any).avatarUrl === "string" 
        && (user as any).avatarUrl.trim().length > 0;
      const tgPhotoUrl = typeof telegramUse.photo_url === "string" 
        ? telegramUse.photo_url.trim() 
        : "";

      if (!hasAvatarInDb && tgPhotoUrl) {
        (user as any).avatarUrl = tgPhotoUrl;
        needSave = true;
      }

      if (needSave) {
        await user.save();
        console.log("✅ [AUTH] User data updated from Telegram");
      }
    }
    
    // 5️⃣ Прикрепляем к req и res.locals
    req.user = user;
    req.tgUser = telegramUse;
    res.locals.user = user;
    
    console.log("✅ [AUTH] Middleware passed, user attached:", {
      userId: user._id,
      tgId: user.tgId,
      hasAccess: user.hasAccess,
    });

    next();
  } catch (error) {
    console.error("❌ [AUTH] Unhandled error:", error);
    return res.status(500).json({
      success: false,
      error: "internal_error",
      message: "Internal server error",
    });
  }
}