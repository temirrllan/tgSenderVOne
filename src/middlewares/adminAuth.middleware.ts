// backend/src/middlewares/adminAuth.middleware.ts
import type { Request, Response, NextFunction } from "express";
import { Admin } from "../models/Admin.js";
import { verifyTelegramWebAppData } from "../utils/telegram.js";
import { isDev } from "../config/env.js";
import qs from "qs";

export interface AdminAuthRequest extends Request {
  admin?: any;
  tgAdmin?: any;
}

/**
 * Middleware авторизации админов через Telegram WebApp
 */
export async function adminAuthMiddleware(
  req: AdminAuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    console.log("🔐 [ADMIN AUTH] Start:", {
      method: req.method,
      url: req.originalUrl,
      hasAuth: !!req.headers.authorization,
    });

    const authHeader = req.headers.authorization || "";
    
    if (!authHeader) {
      console.error("❌ [ADMIN AUTH] Missing Authorization header");
      return res.status(401).json({
        success: false,
        error: "unauthorized",
        message: "Missing Authorization header",
      });
    }
    
    let telegramUserId: number;
    let telegramUser: any = {};
    
    // Декодируем base64 → initData string
    let initDataString: string;
    try {
      initDataString = Buffer.from(authHeader, "base64").toString("utf-8");
      
      console.log("🔓 [ADMIN AUTH] Decoded initData:", {
        length: initDataString.length,
        preview: initDataString.slice(0, 100),
      });
    } catch (decodeError) {
      console.error("❌ [ADMIN AUTH] Failed to decode base64:", decodeError);
      return res.status(401).json({
        success: false,
        error: "invalid_auth_format",
        message: "Invalid Authorization format",
      });
    }
    
    // Production: проверяем подпись Telegram
    try {
      const verified = verifyTelegramWebAppData(initDataString);
      
      telegramUserId = verified.user.id;
      telegramUser = verified.user;
      
      console.log("✅ [ADMIN AUTH] Telegram signature verified:", { 
        telegramUserId, 
        username: telegramUser.username,
      });
    } catch (verifyError) {
      console.error("❌ [ADMIN AUTH] Signature verification failed:", verifyError);

      // Development fallback
      if (isDev) {
        console.warn("⚠️ [DEV MODE] Using fallback without signature check");
        
        try {
          const params = qs.parse(initDataString);
          const userStr = params.user as string;
          
          if (userStr) {
            const parsed = JSON.parse(userStr);
            telegramUserId = parsed.id;
            telegramUser = parsed;
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
        return res.status(401).json({
          success: false,
          error: "invalid_signature",
          message: "Invalid Telegram signature",
        });
      }
    }
    
    // Ищем админа в БД
    let admin = await Admin.findOne({ telegramId: telegramUserId }).exec();
    
    if (!admin) {
      console.log("❌ [ADMIN AUTH] Admin not found:", telegramUserId);
      return res.status(403).json({
        success: false,
        error: "access_denied",
        message: "You are not an admin",
      });
    }

    if (!admin.isActive) {
      console.log("❌ [ADMIN AUTH] Admin is not active:", telegramUserId);
      return res.status(403).json({
        success: false,
        error: "access_denied",
        message: "Your admin access is disabled",
      });
    }

    // Обновляем данные админа из Telegram
    let needSave = false;

    if (telegramUser.username && telegramUser.username !== admin.username) {
      admin.username = telegramUser.username;
      needSave = true;
    }

    if (telegramUser.first_name && telegramUser.first_name !== admin.firstName) {
      admin.firstName = telegramUser.first_name;
      needSave = true;
    }

    if (telegramUser.last_name && telegramUser.last_name !== admin.lastName) {
      admin.lastName = telegramUser.last_name;
      needSave = true;
    }

    // Аватар
    const tgPhotoUrl = typeof telegramUser.photo_url === "string" 
      ? telegramUser.photo_url.trim() 
      : "";

    if (tgPhotoUrl) {
      const currentAvatar = typeof admin.avatarUrl === "string" 
        ? admin.avatarUrl.trim() 
        : "";
      
      if (currentAvatar !== tgPhotoUrl) {
        admin.avatarUrl = tgPhotoUrl;
        needSave = true;
      }
    }

    // Обновляем lastLoginAt
    admin.lastLoginAt = new Date();
    needSave = true;

    if (needSave) {
      await admin.save();
      console.log("✅ [ADMIN AUTH] Admin data updated");
    }
    
    // Прикрепляем к req и res.locals
    req.admin = admin;
    req.tgAdmin = telegramUser;
    res.locals.admin = admin;
    
    console.log("✅ [ADMIN AUTH] Middleware passed:", {
      adminId: admin._id,
      tgId: admin.telegramId,
      role: admin.role,
    });

    next();
  } catch (error) {
    console.error("❌ [ADMIN AUTH] Unhandled error:", error);
    return res.status(500).json({
      success: false,
      error: "internal_error",
      message: "Internal server error",
    });
  }
}