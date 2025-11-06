// src/routes/api.ts
import express, {
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
  type Router,
} from "express";
import mongoose, { Types } from "mongoose";
import jwt from "jsonwebtoken";

import { Group } from "../common/mongo/Models/Group.js";
import { User, type IUser } from "../common/mongo/Models/User.js";
import { Bot } from "../common/mongo/Models/Bot.js";
import { TxHistory } from "../common/mongo/Models/TxHistory.js";

const router: Router = express.Router();

/* ──────────────────────────────────────────
   Единый формат ответов
   ────────────────────────────────────────── */
function success(res: Response, data: unknown, status = 200, message = "success sosal") {
  return res.status(status).json({ status, message, data });
}
function fail(res: Response, status = 400, message = "error") {
  return res.status(status).json({ status, message });
}

/* ──────────────────────────────────────────
   Helpers
   ────────────────────────────────────────── */
function generate12DigitCode(): string {
  const ts = Date.now().toString().slice(-8);
  const rnd = Math.floor(Math.random() * 1e8).toString().padStart(8, "0");
  return (ts + rnd).slice(0, 12);
}

/* =========================================
   AUTH MIDDLEWARE (JWT или x-tg-id в dev)
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
   POST /api/users/:id — профиль (self или admin)
   (дублирует GET-вариант по требованию)
========================================= */
router.post("/users/:id", authMiddleware, async (req: Request, res: Response) => {
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
    console.error("POST /api/users/:id error", err);
    return fail(res, 500, "internal_error");
  }
});

/* =========================================
   GET /api/users/:id — профиль (self или admin)
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
   GET /api/bots — список ботов пользователя (ТОЛЬКО свои)
========================================= */
router.get("/bots", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const u = res.locals.user as IUser | undefined;
    if (!u) return fail(res, 401, "user_not_found");

    const bots = await Bot.find({ owner: u._id })
      .select("owner username photoUrl messageText interval status groups createdAt")
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return success(res, { items: bots, total: bots.length, scope: "own" });
  } catch (err) {
    console.error("GET /api/bots error", err);
    return fail(res, 500, "internal_error");
  }
});

/* =========================================
   GET /api/bots/:id — конкретный бот (свой/админ)
========================================= */
router.get("/bots/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const u = res.locals.user as IUser | undefined;
    if (!u) return fail(res, 401, "user_not_found");

    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) return fail(res, 400, "invalid_id");

    const isAdmin = (u as any)?.isAdmin === true;

    const botDoc = await Bot.findById(id)
      .select("owner username photoUrl messageText interval status chats groups createdAt")
      .lean()
      .exec();

    if (!botDoc) return fail(res, 404, "bot_not_found");
    if (!isAdmin && String(botDoc.owner) !== String(u._id)) return fail(res, 403, "forbidden");

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

/* =========================================
   POST /api/bots/:id/update — обновить своего бота (user)
   Разрешено: username, photoUrl, messageText, interval
========================================= */
router.post("/bots/:id/update", authMiddleware, express.json(), async (req, res) => {
  try {
    const u = res.locals.user as IUser | undefined;
    if (!u) return fail(res, 401, "user_not_found");

    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) return fail(res, 400, "invalid_id");

    const bot = await Bot.findById(id).exec();
    if (!bot) return fail(res, 404, "bot_not_found");
    const isAdmin = (u as any)?.isAdmin === true;
    if (!isAdmin && String(bot.owner) !== String(u._id)) return fail(res, 403, "forbidden");

    const { username, photoUrl, messageText, interval } = req.body as Partial<{
      username: string;
      photoUrl: string | null;
      messageText: string;
      interval: number | string;
    }>;

    if (typeof username !== "undefined") {
      const clean = String(username).replace(/^@/, "").trim();
      if (!clean) return fail(res, 400, "bad_username");
      (bot as any).username = clean;
    }

    if (typeof photoUrl !== "undefined") {
      const val = photoUrl === null ? "" : String(photoUrl).trim();
      (bot as any).photoUrl = val;
    }

    if (typeof messageText !== "undefined") {
      const txt = String(messageText).trim();
      if (!txt) return fail(res, 400, "bad_messageText");
      (bot as any).messageText = txt;
    }

    if (typeof interval !== "undefined") {
      const allowed = [3600, 7200, 10800, 14400, 18000, 21600, 43200, 86400];
      const val = Number(interval);
      if (!allowed.includes(val)) return fail(res, 400, "bad_interval");
      (bot as any).interval = val as any;
    }

    await bot.save();

    const dto = await Bot.findById(bot._id)
      .select("owner username photoUrl messageText interval status groups createdAt")
      .lean()
      .exec();

    return success(res, { bot: dto });
  } catch (err) {
    console.error("POST /api/bots/:id/update (user) error", err);
    return fail(res, 500, "internal_error");
  }
});

/* =========================================
   GET /api/users/:id/bots — список ботов юзера (сам/админ)
========================================= */
router.get("/users/:id/bots", authMiddleware, async (req: Request, res: Response) => {
  try {
    const requester = res.locals.user as IUser | undefined;
    if (!requester) return fail(res, 401, "no_auth");

    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) return fail(res, 400, "invalid_id");

    const isSelf = String(requester._id) === id;
    const isAdmin = (requester as any)?.isAdmin === true;
    if (!isSelf && !isAdmin) return fail(res, 403, "forbidden");

    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const search = String(req.query.search ?? "").trim();
    const status = String(req.query.status ?? "").trim();

    const q: Record<string, any> = { owner: id };
    if (search) q.$or = [{ username: new RegExp(search, "i") }, { messageText: new RegExp(search, "i") }];
    if (status && ["active", "blocked", "deleted"].includes(status)) q.status = status;

    const [items, total] = await Promise.all([
      Bot.find(q)
        .select("owner username photoUrl messageText interval status groups createdAt")
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean()
        .exec(),
      Bot.countDocuments(q).exec(),
    ]);

    return success(res, {
      items,
      total,
      limit,
      offset,
      userId: id,
      filters: { search: search || undefined, status: q.status || undefined },
    });
  } catch (err) {
    console.error("GET /api/users/:id/bots error", err);
    return fail(res, 500, "internal_error");
  }
});

/* =========================================
   POST /api/bots/:id/groups/add — добавить группу/чат (user/админ)
   Через отдельную коллекцию Group (ref в Bot.groups)
========================================= */
router.post("/bots/:id/groups/add", authMiddleware, express.json(), async (req, res) => {
  try {
    const me = res.locals.user as IUser | undefined;
    if (!me) return fail(res, 401, "no_auth");

    const botId = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(botId)) return fail(res, 400, "invalid_id");

    const { chatId, title } = req.body as { chatId?: string | number; title?: string };
    if (!chatId || !title) return fail(res, 400, "missing_fields");

    const bot = await Bot.findById(botId).exec();
    if (!bot) return fail(res, 404, "bot_not_found");

    const isAdmin = (me as any)?.isAdmin === true;
    if (!isAdmin && String(bot.owner) !== String(me._id)) return fail(res, 403, "forbidden");

    const group = await Group.findOneAndUpdate(
      { chatId: String(chatId) },
      { $setOnInsert: { chatId: String(chatId), title: String(title) } },
      { new: true, upsert: true }
    ).lean();

    const already = (bot.groups ?? []).some((g: any) => String(g) === String(group._id));
    if (!already) {
      bot.groups = ([...(bot.groups ?? []), group._id as any]) as any;
      await bot.save();
    }

    return success(res, {
      botId: bot._id,
      group: { _id: group._id, chatId: group.chatId, title: group.title },
      groupsCount: bot.groups?.length ?? 0,
    });
  } catch (err) {
    console.error("POST /api/bots/:id/groups/add error", err);
    return fail(res, 500, "internal_error");
  }
});

/* =========================================
   POST /api/bots/:id/groups/delete — удалить группу/чат (user/админ)
========================================= */
router.post("/bots/:id/groups/delete", authMiddleware, express.json(), async (req, res) => {
  try {
    const me = res.locals.user as IUser | undefined;
    if (!me) return fail(res, 401, "no_auth");

    const botId = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(botId)) return fail(res, 400, "invalid_id");

    const { chatId } = req.body as { chatId?: string | number };
    if (!chatId) return fail(res, 400, "missing_chatId");

    const bot = await Bot.findById(botId).exec();
    if (!bot) return fail(res, 404, "bot_not_found");

    const isAdmin = (me as any)?.isAdmin === true;
    if (!isAdmin && String(bot.owner) !== String(me._id)) return fail(res, 403, "forbidden");

    const group = await Group.findOne({ chatId: String(chatId) }).lean();
    if (!group) return fail(res, 404, "group_not_found");

    const before = bot.groups?.length ?? 0;
    bot.groups = (bot.groups ?? []).filter((g: any) => String(g) !== String(group._id)) as any;
    const after = bot.groups?.length ?? 0;
    if (before === after) return fail(res, 404, "group_not_found");

    await bot.save();

    return success(res, { botId: bot._id, deletedChatId: String(chatId), groupsCount: after });
  } catch (err) {
    console.error("POST /api/bots/:id/groups/delete error", err);
    return fail(res, 500, "internal_error");
  }
});

/* =========================================
   POST /api/bots/create — создать покупку бота (user flow)
   Валидируем поля, создаём TxHistory (pending), отдаём кошелёк+код
========================================= */
router.post("/bots/create", authMiddleware, express.json(), async (req, res) => {
  try {
    const me = res.locals.user as IUser | undefined;
    if (!me) return fail(res, 401, "no_auth");

    const { username, messageText, interval, photoUrl } = req.body as Partial<{
      username: string;
      messageText: string;
      interval: number | string;
      photoUrl: string | null;
    }>;

    if (!username) return fail(res, 400, "bad_username");
    if (!messageText) return fail(res, 400, "bad_messageText");
    if (typeof interval === "undefined") return fail(res, 400, "bad_interval");

    const cleanUsername = String(username).replace(/^@/, "").trim();
    if (!cleanUsername) return fail(res, 400, "bad_username");

    const allowedIntervals = [3600, 7200, 10800, 14400, 18000, 21600, 43200, 86400];
    const iv = Number(interval);
    if (!allowedIntervals.includes(iv)) return fail(res, 400, "bad_interval");

    const BOT_PRICE = Number(process.env.BOT_PRICE ?? 10);
    const BOT_CURRENCY = process.env.BOT_CURRENCY ?? "USDT";
    const CRYPTO_WALLET = process.env.CRYPTO_WALLET || process.env.CRYPTO_WALLET_BOT || "";
    if (!CRYPTO_WALLET) return fail(res, 500, "wallet_not_configured");

    // Генерим код и создаём pending-транзакцию
    const code12 = generate12DigitCode();
    const tx = await TxHistory.create({
      user: me._id as unknown as Types.ObjectId,
      type: "BOT_PURCHASE",
      status: "pending",
      amount: BOT_PRICE,
      currency: BOT_CURRENCY,
      wallet: CRYPTO_WALLET,
      code12,
      meta: {
        request: {
          username: cleanUsername,
          messageText: String(messageText).trim(),
          interval: iv,
          photoUrl: photoUrl === null ? "" : (photoUrl ? String(photoUrl).trim() : ""),
        },
      },
    });

    // фронту — только безопасные поля
    return success(
      res,
      {
        txId: tx._id,
        wallet: CRYPTO_WALLET,
        code12,
        amount: BOT_PRICE,
        currency: BOT_CURRENCY,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // подсказка фронту
        note: "Укажите 12-значный код в комментарии/мемо перевода. Проверка может занять до 10 минут.",
      },
      201
    );
  } catch (err) {
    console.error("POST /api/bots/create error", err);
    return fail(res, 500, "internal_error");
  }
});

/* =========================================
   11) POST /api/bots/:id/block — заблокировать бота (владелец/админ)
========================================= */
router.post("/bots/:id/block", authMiddleware, async (req, res) => {
  try {
    const me = res.locals.user as IUser | undefined;
    if (!me) return fail(res, 401, "no_auth");

    const id = String(req.params.id ?? "");
    if (!mongoose.isValidObjectId(id)) return fail(res, 400, "invalid_id");

    const bot = await Bot.findById(id).exec();
    if (!bot) return fail(res, 404, "bot_not_found");

    const isAdmin = (me as any)?.isAdmin === true;
    if (!isAdmin && String(bot.owner) !== String(me._id)) return fail(res, 403, "forbidden");

    (bot as any).status = "blocked";
    await bot.save();

    return success(res, { _id: bot._id, status: (bot as any).status });
  } catch (err) {
    console.error("POST /api/bots/:id/block error", err);
    return fail(res, 500, "internal_error");
  }
});

// 12) POST /api/bots/:id/unblock — разблокировать бота (владелец/админ)
router.post("/bots/:id/unblock", authMiddleware, async (req, res) => {
  try {
    const me = res.locals.user as IUser | undefined;
    if (!me) return fail(res, 401, "no_auth");

    // ✅ жёстко нормализуем id в строку и используем mongoose.isValidObjectId
    const id = String(req.params.id ?? "");
    if (!mongoose.isValidObjectId(id)) return fail(res, 400, "invalid_id");

    const bot = await Bot.findById(id).exec();
    if (!bot) return fail(res, 404, "bot_not_found");

    const isAdmin = (me as any)?.isAdmin === true;
    if (!isAdmin && String(bot.owner) !== String(me._id)) {
      return fail(res, 403, "forbidden");
    }

    (bot as any).status = "active";
    await bot.save();

    return success(res, { _id: bot._id, status: (bot as any).status });
  } catch (err) {
    console.error("POST /api/bots/:id/unblock error", err);
    return fail(res, 500, "internal_error");
  }
});

/* =========================================
   13 POST /api/bots/create — создать СВОЕГО бота (user)
   Требует: u.hasAccess === true
   Body: { username, messageText, interval, photoUrl? }
========================================= */
router.post("/bots/create", authMiddleware, express.json(), async (req: Request, res: Response) => {
  try {
    const u = res.locals.user as IUser | undefined;
    if (!u) return fail(res, 401, "user_not_found");

    // доступ к мини-приложению оплачен?
    if (!u.hasAccess) return fail(res, 402, "access_required");

    const { username, messageText, interval, photoUrl } = req.body as Partial<{
      username: string;
      messageText: string;
      interval: number | string;
      photoUrl: string | null;
    }>;

    // валидация
    if (!username) return fail(res, 400, "bad_username");
    if (!messageText) return fail(res, 400, "bad_messageText");
    if (typeof interval === "undefined") return fail(res, 400, "bad_interval");

    const cleanUsername = String(username).replace(/^@/, "").trim();
    if (!cleanUsername) return fail(res, 400, "bad_username");

    const allowed = [3600, 7200, 10800, 14400, 18000, 21600, 43200, 86400]; // сек: 1ч..24ч
    const iv = Number(interval);
    if (!allowed.includes(iv)) return fail(res, 400, "bad_interval");

    // создаём
    const bot = new Bot({
      owner: u._id,
      username: cleanUsername,
      photoUrl: photoUrl === null ? "" : (photoUrl ? String(photoUrl).trim() : ""),
      messageText: String(messageText).trim(),
      interval: iv as any,
      status: "active",
      groups: [],
      chats: [],
    });

    await bot.save();

    // привязываем к пользователю
    const freshUser = await User.findById(u._id).exec();
    if (freshUser) {
      freshUser.bots = Array.isArray(freshUser.bots) ? freshUser.bots : [];
      if (!freshUser.bots.some((bId) => String(bId) === String(bot._id))) {
        freshUser.bots.push(bot._id as any);
        await freshUser.save();
      }
    }

    const dto = await Bot.findById(bot._id)
      .select("owner username photoUrl messageText interval status groups createdAt")
      .lean()
      .exec();

    return success(res, { bot: dto }, 201);
  } catch (err) {
    console.error("POST /api/bots/create error", err);
    return fail(res, 500, "internal_error");
  }
});


/* =========================================
   14) POST /api/bots/:id/delete — удалить бота (soft) (владелец/админ)
========================================= */
router.post("/bots/:id/delete", authMiddleware, async (req, res) => {
  try {
    const me = res.locals.user as IUser | undefined;
    if (!me) return fail(res, 401, "no_auth");

    const id = String(req.params.id ?? "");
  if (!mongoose.isValidObjectId(id)) return fail(res, 400, "invalid_id");

    const bot = await Bot.findById(id).exec();
    if (!bot) return fail(res, 404, "bot_not_found");

    const isAdmin = (me as any)?.isAdmin === true;
    if (!isAdmin && String(bot.owner) !== String(me._id)) return fail(res, 403, "forbidden");

    // soft-delete
    (bot as any).status = "deleted";
    await bot.save();

    // вычистим ссылку у владельца
    const owner = await User.findById(bot.owner as unknown as Types.ObjectId).exec();
    if (owner) {
      owner.bots = (owner.bots || []).filter((bId) => String(bId) !== String(bot._id));
      await owner.save();
    }

    return success(res, { _id: bot._id, status: (bot as any).status });
  } catch (err) {
    console.error("POST /api/bots/:id/delete error", err);
    return fail(res, 500, "internal_error");
  }
});

export default router;
