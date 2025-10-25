// src/routes/api.ts
import express from "express";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";

import { User, type IUser } from "../common/mongo/Models/User.js";
import { Bot, type IBot } from "../common/mongo/Models/Bot.js";

const router = express.Router();

/* =========================================
   AUTH MIDDLEWARE
   - Bearer <JWT> (prod/dev)
   - Dev fallback: header x-tg-id (не в production)
   Пользователь кладётся в res.locals.user
========================================= */
const authMiddleware: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = (req.header("authorization") || "").trim();
    const jwtSecret = process.env.JWT_SECRET;
    const isProd = (process.env.NODE_ENV || "development") === "production";

    // 1) JWT Bearer
    if (authHeader.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.slice(7).trim();
      if (!jwtSecret) return res.status(500).json({ error: "server_misconfigured" });

      try {
        const decoded = jwt.verify(token, jwtSecret) as { sub?: string; tgId?: number | string };
        let user: IUser | null = null;

        if (decoded?.sub && mongoose.Types.ObjectId.isValid(String(decoded.sub))) {
          user = await User.findById(decoded.sub).exec();
        }
        if (!user && typeof decoded?.tgId !== "undefined") {
          const tgId = /^\d+$/.test(String(decoded.tgId)) ? Number(decoded.tgId) : String(decoded.tgId);
          user = await User.findOne({ tgId }).exec();
        }

        if (user) {
          res.locals.user = user;
          return next();
        }
      } catch {
        /* пойдём во фолбек ниже */
      }
    }

    // 2) Dev fallback (только не в production)
    if (!isProd) {
      const xTg = (req.header("x-tg-id") || "").trim();
      if (xTg) {
        const tgId = /^\d+$/.test(xTg) ? Number(xTg) : xTg;
        const user = await User.findOne({ tgId }).exec();
        if (user) {
          res.locals.user = user;
          return next();
        }
      }
    }

    return res.status(401).json({ error: "no_auth" });
  } catch (err) {
    console.error("authMiddleware error", err);
    return res.status(500).json({ error: "internal_error" });
  }
};

/* =========================================
   GET /api/me — профиль
========================================= */
router.get("/me", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const u = res.locals.user as IUser | undefined;
    if (!u) return res.status(401).json({ error: "user_not_found" });

    const out = {
      tgId: u.tgId,
      username: u.username ?? null,
      firstName: u.firstName ?? null,
      lastName: u.lastName ?? null,
      status: u.status,
      hasAccess: !!u.hasAccess,
      referral: {
        code: u.refCode,
        directCount: Array.isArray(u.referrals) ? u.referrals.length : 0,
        levels: u.referralLevels,
        balance: u.referralBalance,
        earnedTotal: u.referralEarnedTotal,
      },
      botsCount: Array.isArray(u.bots) ? u.bots.length : 0,
      accessGrantedAt: u.accessGrantedAt ?? null,
      createdAt: u.createdAt,
    };
    return res.json({ ok: true, user: out });
  } catch (err) {
    console.error("GET /api/me error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/* =========================================
   GET /api/dashboard — сводка
========================================= */
router.get("/dashboard", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const u = res.locals.user as IUser | undefined;
    if (!u) return res.status(401).json({ error: "user_not_found" });

    const botsCount = await Bot.countDocuments({ owner: u._id }).exec();
    const hasAccess = !!u.hasAccess;

    return res.json({
      ok: true,
      data: {
        user: {
          tgId: u.tgId,
          username: u.username ?? null,
          firstName: u.firstName ?? null,
          lastName: u.lastName ?? null,
          hasAccess,
        },
        botsCount,
        hasAccess,
      },
    });
  } catch (err) {
    console.error("GET /api/dashboard error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/* =========================================
   GET /api/bots — список ботов юзера
========================================= */
router.get("/bots", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const u = res.locals.user as IUser | undefined;
    if (!u) return res.status(401).json({ error: "user_not_found" });

    const bots = await Bot.find({ owner: u._id })
    .select("username photoUrl messageText interval status createdAt")
    .lean()
    .exec();


    return res.json({ ok: true, items: bots });
  } catch (err) {
    console.error("GET /api/bots error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/* =========================================
   GET /api/bots/:id — детальная
========================================= */
router.get("/bots/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const u = res.locals.user as IUser | undefined;
    if (!u) return res.status(401).json({ error: "user_not_found" });

    const id = req.params.id;
    if (typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "invalid_id" });
    }

    const botDoc = await Bot.findOne({
      _id: new mongoose.Types.ObjectId(id),
      owner: u._id,
    })
      .select("username photoUrl messageText interval status chats groups createdAt")
      .lean()
      .exec();

    if (!botDoc) return res.status(404).json({ error: "not_found" });
    return res.json({ ok: true, bot: botDoc });
  } catch (err) {
    console.error("GET /api/bots/:id error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/* =========================================
   GET /api/referral — рефералка
========================================= */
router.get("/referral", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const u = res.locals.user as IUser | undefined;
    if (!u) return res.status(401).json({ error: "user_not_found" });

    const botName = (process.env.MAIN_BOT_USERNAME || "").replace(/^@/, "");
    const deeplink = botName ? `https://t.me/${botName}?start=${encodeURIComponent(u.refCode)}` : null;

    const directCount = await User.countDocuments({ invitedBy: u._id }).exec();
    const lastRefs = await User.find({ invitedBy: u._id })
      .select("tgId username firstName createdAt")
      .sort({ createdAt: -1 })
      .limit(10)
      .lean()
      .exec();

    return res.json({
      ok: true,
      deeplink,
      code: u.refCode,
      levels: u.referralLevels,
      balance: u.referralBalance,
      earnedTotal: u.referralEarnedTotal,
      directCount,
      lastReferrals: lastRefs,
    });
  } catch (err) {
    console.error("GET /api/referral error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/* =========================================
   DEV helper: POST /api/dev/grant-access
   – вручную выдать доступ (не для prod)
========================================= */
router.post("/dev/grant-access", authMiddleware, express.json(), async (_req: Request, res: Response) => {
  try {
    const isProd = (process.env.NODE_ENV || "development") === "production";
    if (isProd) return res.status(403).json({ error: "forbidden" });

    const u = await User.findById((res.locals.user as IUser)._id).exec();
    if (!u) return res.status(404).json({ error: "user_not_found" });

    u.hasAccess = true;
    u.accessGrantedAt = new Date();
    await u.save();

    return res.json({ ok: true, hasAccess: u.hasAccess, accessGrantedAt: u.accessGrantedAt });
  } catch (err) {
    console.error("POST /api/dev/grant-access error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
