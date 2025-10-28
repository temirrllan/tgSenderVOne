// src/routes/api.ts
import express, {
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
  type Router,
} from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";

import { User, type IUser } from "../common/mongo/Models/User.js";
import { Bot } from "../common/mongo/Models/Bot.js";

const router: Router = express.Router();

/* ──────────────────────────────────────────
   Единый формат ответов (как сказал начальник)
   ────────────────────────────────────────── */
function success(res: Response, data: unknown, status = 200, message = "success") {
  return res.status(status).json({ status, message, data });
}
function fail(res: Response, status = 400, message = "error") {
  return res.status(status).json({ status, message });
}

/* =========================================
   AUTH MIDDLEWARE
   Проверяет JWT (или x-tg-id в dev)
   user кладётся в res.locals.user
========================================= */
const authMiddleware: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = (req.header("authorization") || "").trim();
    const jwtSecret = process.env.JWT_SECRET;
    const isProd = (process.env.NODE_ENV || "development") === "production";

    // 1) JWT Bearer
    if (authHeader.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.slice(7).trim();
      if (!jwtSecret) return fail(res, 500, "server_misconfigured");

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
        /* fallthrough */
      }
    }

    // 2) Dev fallback
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

    return fail(res, 401, "no_auth");
  } catch (err) {
    console.error("authMiddleware error", err);
    return fail(res, 500, "internal_error");
  }
};

/* =========================================
   GET /api/me — профиль пользователя (mini-app)
========================================= */
router.get("/me", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const u = res.locals.user as IUser | undefined;
    if (!u) return fail(res, 401, "user_not_found");

    const data = {
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

    return success(res, { user: data });
  } catch (err) {
    console.error("GET /api/me error", err);
    return fail(res, 500, "internal_error");
  }
});

/* =========================================
   GET /api/users/:id — профиль (для приложения)
   Доступ: сам пользователь или админ.
========================================= */
router.get("/users/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const requester = res.locals.user as IUser | undefined;
    if (!requester) return fail(res, 401, "no_auth");

    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) return fail(res, 400, "invalid_id");

    const isSelf = String(requester._id) === id;
    const isAdmin = (requester as any).isAdmin === true;
    if (!isSelf && !isAdmin) return fail(res, 403, "forbidden");

    const user = await User.findById(id).lean().exec();
    if (!user) return fail(res, 404, "user_not_found");

    const [botsCount, directReferrals] = await Promise.all([
      Bot.countDocuments({ owner: user._id }).exec(),
      User.countDocuments({ invitedBy: user._id }).exec(),
    ]);

    return success(res, {
      user: {
        _id: user._id,
        tgId: user.tgId,
        username: user.username ?? null,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        status: user.status,
        hasAccess: !!user.hasAccess,
        refCode: user.refCode,
        referral: {
          levels: user.referralLevels,
          balance: user.referralBalance,
          earnedTotal: user.referralEarnedTotal,
        },
        accessGrantedAt: user.accessGrantedAt ?? null,
        createdAt: user.createdAt,
      },
      stats: { botsCount, directReferrals },
    });
  } catch (err) {
    console.error("GET /api/users/:id error", err);
    return fail(res, 500, "internal_error");
  }
});

/* =========================================
   GET /api/bots — список ботов пользователя
========================================= */
router.get("/bots", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const u = res.locals.user as IUser | undefined;
    if (!u) return fail(res, 401, "user_not_found");

    const bots = await Bot.find({ owner: u._id })
      .select("username photoUrl messageText interval status createdAt")
      .lean()
      .exec();

    return success(res, { items: bots });
  } catch (err) {
    console.error("GET /api/bots error", err);
    return fail(res, 500, "internal_error");
  }
});

/* =========================================
   GET /api/bots/:id — конкретный бот пользователя
========================================= */
router.get("/bots/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const u = res.locals.user as IUser | undefined;
    if (!u) return fail(res, 401, "user_not_found");

    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) return fail(res, 400, "invalid_id");

    const botDoc = await Bot.findOne({ _id: id, owner: u._id })
      .select("username photoUrl messageText interval status chats groups createdAt")
      .lean()
      .exec();

    if (!botDoc) return fail(res, 404, "bot_not_found");
    return success(res, { bot: botDoc });
  } catch (err) {
    console.error("GET /api/bots/:id error", err);
    return fail(res, 500, "internal_error");
  }
});

/* =========================================
   GET /api/referral — инфо по рефералке
========================================= */
router.get("/referral", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const u = res.locals.user as IUser | undefined;
    if (!u) return fail(res, 401, "user_not_found");

    const botName = (process.env.MAIN_BOT_USERNAME || "").replace(/^@/, "");
    const deeplink = botName ? `https://t.me/${botName}?start=${encodeURIComponent(u.refCode)}` : null;

    const directCount = await User.countDocuments({ invitedBy: u._id }).exec();
    const lastRefs = await User.find({ invitedBy: u._id })
      .select("tgId username firstName createdAt")
      .sort({ createdAt: -1 })
      .limit(10)
      .lean()
      .exec();

    return success(res, {
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
    return fail(res, 500, "internal_error");
  }
});

/* =========================================
   DEV helper: POST /api/dev/grant-access
========================================= */
router.post("/dev/grant-access", authMiddleware, express.json(), async (_req: Request, res: Response) => {
  try {
    const isProd = (process.env.NODE_ENV || "development") === "production";
    if (isProd) return fail(res, 403, "forbidden");

    const u = await User.findById((res.locals.user as IUser)._id).exec();
    if (!u) return fail(res, 404, "user_not_found");

    u.hasAccess = true;
    u.accessGrantedAt = new Date();
    await u.save();

    return success(res, { hasAccess: u.hasAccess, accessGrantedAt: u.accessGrantedAt });
  } catch (err) {
    console.error("POST /api/dev/grant-access error", err);
    return fail(res, 500, "internal_error");
  }
});

export default router;
