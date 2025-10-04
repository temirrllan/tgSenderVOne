// src/middlewares/adminpanel.middleware.ts
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { User } from "../common/mongo/Models/User.js";

export default async function authMiddleware(req: Request & { user?: any }, res: Response, next: NextFunction) {
  try {
    const authHeader = (req.header("authorization") || "").trim();
    const xTg = req.header("x-tg-id") || "";

    // 1) Попробуем JWT
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      const tokenCandidate = authHeader.slice(7).trim();
      if (tokenCandidate.includes(".")) {
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
          return res.status(500).json({ ok: false, error: "server_misconfigured", message: "JWT_SECRET not set" });
        }
        try {
          const decoded: any = jwt.verify(tokenCandidate, jwtSecret);
          const maybeNumeric = /^\d+$/.test(String(decoded.tgId)) ? Number(decoded.tgId) : String(decoded.tgId);
          const user = await User.findOne({ tgId: maybeNumeric }).lean().exec();
          if (!user) return res.status(401).json({ ok: false, error: "user_not_found" });
          req.user = user;
          return next();
        } catch (err) {
          // invalid JWT -> fallthrough to fallback below
          console.warn("authMiddleware: jwt verify failed", err);
        }
      }
    }

    // 2) Fallback dev: x-tg-id or Authorization: Bearer <tgId>
    let tgId: string | undefined;
    if (xTg) tgId = String(xTg).trim();
    else if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      const maybe = authHeader.slice(7).trim();
      if (/^\d+$/.test(maybe)) tgId = maybe;
    }

    if (!tgId) {
      return res.status(401).json({ ok: false, error: "no_auth", message: "Provide Authorization: Bearer <jwt> or x-tg-id / Bearer <tgId>" });
    }

    const maybeNumeric = /^\d+$/.test(tgId) ? Number(tgId) : tgId;
    const user = await User.findOne({ tgId: maybeNumeric }).lean().exec();
    if (!user) return res.status(401).json({ ok: false, error: "user_not_found" });

    req.user = user;
    return next();
  } catch (err) {
    console.error("authMiddleware error", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
}
