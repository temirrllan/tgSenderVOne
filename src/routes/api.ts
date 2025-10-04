// src/routes/api.ts
import express from "express";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { User } from "../common/mongo/Models/User.js";
import { Bot } from "../common/mongo/Models/Bot.js";

const router = express.Router();

interface AuthRequest extends Request {
  user?: any;
}

/**
 * Простая auth middleware (JWT или x-tg-id dev fallback)
 */
async function authMiddleware(req: AuthRequest, res: Response, next: any) {
  try {
    const authHeader = (req.header("authorization") || "").trim();
    const xTg = req.header("x-tg-id") || "";

    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      const tokenCandidate = authHeader.slice(7).trim();
      if (tokenCandidate.includes(".")) {
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) return res.status(500).json({ error: "server_misconfigured" });
        try {
          const decoded: any = jwt.verify(tokenCandidate, jwtSecret);
          const maybeNumeric = /^\d+$/.test(String(decoded.tgId)) ? Number(decoded.tgId) : String(decoded.tgId);
          const user = await User.findOne({ tgId: maybeNumeric }).lean().exec();
          if (!user) return res.status(401).json({ error: "user_not_found" });
          req.user = user;
          return next();
        } catch (e) {
          console.warn("JWT verify failed", e);
        }
      }
    }

    let tgId: string | undefined;
    if (xTg) tgId = String(xTg).trim();
    else if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      const maybe = authHeader.slice(7).trim();
      if (/^\d+$/.test(maybe)) tgId = maybe;
    }

    if (!tgId) return res.status(401).json({ error: "no_auth" });

    const maybeNumeric = /^\d+$/.test(tgId) ? Number(tgId) : tgId;
    const user = await User.findOne({ tgId: maybeNumeric }).lean().exec();
    if (!user) return res.status(401).json({ error: "user_not_found" });
    req.user = user;
    return next();
  } catch (err) {
    console.error("authMiddleware error", err);
    return res.status(500).json({ error: "internal_error" });
  }
}

/* POST /api/exchange-token */
router.post("/exchange-token", express.json(), async (req: Request, res: Response) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ ok: false, error: "missing_token" });

    const user = await User.findOne({ webToken: token }).exec();
    if (!user) return res.status(404).json({ ok: false, error: "token_not_found" });

    if (!user.webTokenExpires || user.webTokenExpires.getTime() < Date.now()) {
      await User.updateOne({ _id: user._id }, { $set: { webToken: null, webTokenExpires: null } }).exec();
      return res.status(401).json({ ok: false, error: "token_expired" });
    }

    // consume single-use token
    await User.updateOne({ _id: user._id }, { $set: { webToken: null, webTokenExpires: null } }).exec();

    const jwtSecret = process.env.JWT_SECRET || "dev_secret";
    const tokenJwt = jwt.sign({ tgId: user.tgId, uid: String(user._id) }, jwtSecret, { expiresIn: "30d" });

    return res.json({
      ok: true,
      token: tokenJwt,
      user: {
        tgId: user.tgId,
        tgName: user.tgName,
        tgUsername: user.tgUsername,
        tgImage: user.tgImage,
        phone: (user as any).phone ?? null,
        balance: (user as any).balance ?? 0,
      },
    });
  } catch (err) {
    console.error("POST /api/exchange-token error", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/* Protected endpoints (use authMiddleware) */
router.get("/me", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "user_not_found" });

    const out = {
      tgId: user.tgId,
      tgName: user.tgName,
      tgUsername: user.tgUsername,
      tgImage: user.tgImage,
      phone: user.phone ?? null,
      balance: user.balance ?? 0,
      refBalance: user.refBalance ?? 0,
      level: user.level ?? 0,
      isBanned: user.isBanned ?? false,
      createdAt: user.createdAt,
      referralsCount: Array.isArray(user.referrals) ? user.referrals.length : 0,
    };
    return res.json({ ok: true, user: out });
  } catch (err) {
    console.error("GET /api/me error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

router.get("/dashboard", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "user_not_found" });

    const botsCount = await Bot.countDocuments({ userId: user._id }).exec();
    const hasAccess = (user.level ?? 0) >= 1 || (user.balance ?? 0) > 0;
    const payload = {
      user: {
        tgId: user.tgId,
        tgName: user.tgName,
        tgUsername: user.tgUsername,
        tgImage: user.tgImage,
        phone: user.phone ?? null,
        balance: user.balance ?? 0,
        refBalance: user.refBalance ?? 0,
        level: user.level ?? 0,
      },
      botsCount,
      hasAccess,
    };
    return res.json({ ok: true, data: payload });
  } catch (err) {
    console.error("GET /api/dashboard error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * GET /api/bots
 * Получаем список ботов пользователя
 */
router.get("/bots", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "user_not_found" });

    const bots = await Bot.find({ userId: user._id })
      .select("token username firstName secondName tgImage phone timeout isActive monthlyLimit createdAt")
      .lean()
      .exec();
    return res.json({ ok: true, items: bots });
  } catch (err) {
    console.error("GET /api/bots error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * GET /api/bots/:id
 * Важно: проверить, что req.params.id — string и валиден как ObjectId
 */
router.get("/bots/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "user_not_found" });

    const id = req.params.id;
    // <-- КОРОТКОЕ И ВАЖНОЕ ИЗМЕНЕНИЕ:
    // Проверяем тип сразу (req.params.id возможно undefined по типам Express)
    if (typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "invalid_id" });
    }

    // безопасно используем id и user._id
    const botDoc = await Bot.findOne({ _id: new mongoose.Types.ObjectId(id), userId: (user as any)._id }).lean().exec();
    if (!botDoc) return res.status(404).json({ error: "not_found" });
    return res.json({ ok: true, bot: botDoc });
  } catch (err) {
    console.error("GET /api/bots/:id error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

router.get("/referral", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "user_not_found" });

    const botUsername = (process.env.BOT_USERNAME || "").replace(/^@/, "") || null;
    const deeplink = botUsername ? `https://t.me/${botUsername}?start=${encodeURIComponent(String(user.tgId))}` : null;
    const referralsCount = await User.countDocuments({ ref: String(user.tgId) }).exec();
    const lastReferrals = await User.find({ ref: String(user.tgId) }).select("tgId tgName tgUsername createdAt").sort({ createdAt: -1 }).limit(10).lean().exec();
    return res.json({ ok: true, deeplink, referralsCount, lastReferrals });
  } catch (err) {
    console.error("GET /api/referral error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

router.post("/purchase-access", authMiddleware, express.json(), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "user_not_found" });
    const { price = 0, plan = "default" } = req.body || {};
    if (typeof price !== "number" || price <= 0) return res.status(400).json({ error: "invalid_price" });
    const fresh = await User.findOne({ _id: user._id }).exec();
    if (!fresh) return res.status(404).json({ error: "user_not_found" });
    if ((fresh.balance ?? 0) < price) return res.status(402).json({ error: "insufficient_funds", balance: fresh.balance ?? 0 });
    fresh.balance = (fresh.balance ?? 0) - price;
    fresh.level = Math.max(fresh.level ?? 0, 1);
    await fresh.save();
    return res.json({ ok: true, message: "access_granted", balance: fresh.balance, level: fresh.level, plan });
  } catch (err) {
    console.error("POST /api/purchase-access error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
