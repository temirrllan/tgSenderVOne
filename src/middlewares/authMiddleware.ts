// src/middlewares/authMiddleware.ts
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { User } from "../common/mongo/Models/User.js";

/*
  Универсальный middleware для авторизации.
  Работает по JWT или x-tg-id.
  После проверки добавляет user в req.user
*/

export default async function authMiddleware(
  req: Request & { user?: any },
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = (req.header("authorization") || "").trim();
    const xTg = req.header("x-tg-id") || "";

    // 1️⃣ Проверка JWT токена
    if (authHeader.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.slice(7).trim();
      if (token.includes(".")) {
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
          return res.status(500).json({
            ok: false,
            error: "server_misconfigured",
            message: "JWT_SECRET not set",
          });
        }

        try {
          const decoded: any = jwt.verify(token, jwtSecret);
          const tgId =
            /^\d+$/.test(String(decoded.tgId))
              ? Number(decoded.tgId)
              : String(decoded.tgId);

          const user = await User.findOne({ tgId }).lean().exec();
          if (!user)
            return res
              .status(401)
              .json({ ok: false, error: "user_not_found" });

          req.user = user;
          return next();
        } catch (err) {
          console.warn("authMiddleware: JWT verify failed", err);
        }
      }
    }

    // 2️⃣ Фолбек для dev режима
    let tgId: string | number | undefined;
    if (xTg) tgId = /^\d+$/.test(String(xTg)) ? Number(xTg) : String(xTg);
    else if (authHeader.toLowerCase().startsWith("bearer ")) {
      const maybe = authHeader.slice(7).trim();
      if (/^\d+$/.test(maybe)) tgId = Number(maybe);
    }

    if (!tgId) {
      return res.status(401).json({
        ok: false,
        error: "no_auth",
        message:
          "Provide Authorization: Bearer <jwt> or x-tg-id / Bearer <tgId>",
      });
    }

    const user = await User.findOne({ tgId }).lean().exec();
    if (!user)
      return res.status(401).json({ ok: false, error: "user_not_found" });

    req.user = user;
    next();
  } catch (err) {
    console.error("authMiddleware error", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
}
