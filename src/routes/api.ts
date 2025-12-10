// src/routes/api.ts
import express, {
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
  type Router,
} from "express";
import mongoose, { Types } from "mongoose";
import qs from "qs";


import { User, Bot, Group, TxHistory, DeletedBot, type IUser } from "../models/index.js";
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
   ПРОСТОЙ AUTH MIDDLEWARE как у начальника
   Authorization: base64(initData)
   - декодим initData
   - парсим через qs
   - достаём user.id (tgId)
   - ищем юзера в БД
   - кладём в res.locals.user
========================================= */
const authMiddleware: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authB64 = (req.headers.authorization || "").toString().trim();

    if (!authB64) {
      return res.status(401).json({
        success: false,
        data: { message: "Unauthorized" },
      });
    }

    // 1) base64 -> строка initData
    const initDataStr = Buffer.from(authB64, "base64").toString("utf-8");

    // 2) парсим initData в объект
    const tgData: any = qs.parse(initDataStr);

    // чтобы при желании можно было достать всё сырьё
    (req as any).tgData = tgData;

    if (!tgData.user) {
      return res.status(401).json({
        success: false,
        data: { message: "Unauthorized" },
      });
    }

    // 3) user внутри initData может быть строкой JSON или уже объектом
    let tgUser: any;
    if (typeof tgData.user === "string") {
      try {
        tgUser = JSON.parse(tgData.user);
      } catch {
        return res.status(401).json({
          success: false,
          data: { message: "Bad user json" },
        });
      }
    } else {
      tgUser = tgData.user;
    }

    const tgId = tgUser?.id;
    if (!tgId) {
      return res.status(401).json({
        success: false,
        data: { message: "Bad user data" },
      });
      
    }

    // 4) ищем пользователя в БД
    const user = await User.findOne({ tgId }).exec();
    if (!user) {
      console.log("authMiddleware: user NOT found in DB tgId =", tgId);
      return res.status(401).json({
        success: false,
        data: { message: "User not found" },
      });
    }

    console.log("authMiddleware: found user in DB", {
      tgId: user.tgId,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: (user as any).avatarUrl,
    });

    // 4.1. Подтягиваем актуальные данные из Telegram WebApp
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

    // --- Аватар ---
    // Если аватар уже есть в БД, считаем его главным и НЕ трогаем.
    const hasAvatarInDb =
      typeof (user as any).avatarUrl === "string" &&
      (user as any).avatarUrl.trim().length > 0;

    const tgPhotoUrl =
      typeof tgUser.photo_url === "string" ? tgUser.photo_url.trim() : "";

    // Берём фото из initData ТОЛЬКО если в БД ещё пусто
    if (!hasAvatarInDb && tgPhotoUrl) {
      (user as any).avatarUrl = tgPhotoUrl;
      needSave = true;
      console.log("authMiddleware: set avatarUrl from initData", tgPhotoUrl);
    }

    if (needSave) {
      await user.save().catch((e: any) => {
        console.error("authMiddleware: failed to save user from tgData", e);
      });
    }

    // 5) кладём в res.locals.user и пускаем дальше
    res.locals.user = user;
    return next();
  } catch (error) {
    console.error("authMiddleware error", error);
    return res.status(500).json({
      success: false,
      data: { message: "Internal server error" },
    });
  }
};


/* =========================================
   GET /api/me — профиль пользователя (mini-app)
========================================= */
/* =========================================
   GET /api/me — профиль пользователя (mini-app)
========================================= */
// backend/src/routes/api.ts

router.get("/me", authMiddleware, async (_req: Request, res: Response) => {
  try {
    const user = res.locals.user as IUser | undefined;
    
    console.log("📍 GET /api/me - user from locals:", {
      exists: !!user,
      tgId: user?.tgId,
      username: user?.username,
      hasAccess: user?.hasAccess,
      isAdmin: user?.isAdmin, // ✅ Проверьте что это поле есть
    });
    
    if (!user) {
      console.error("❌ GET /api/me - No user in res.locals!");
      return fail(res, 401, "user_not_found");
    }

    const fullName =
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      user.username ||
      `user${user.tgId}`;

    const rawAvatar = (user as any).avatarUrl;
    const avatarUrl =
      typeof rawAvatar === "string" && rawAvatar.trim().length > 0
        ? rawAvatar.trim()
        : null;

    const data = {
      tgId: user.tgId,
      username: user.username ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      fullName,
      avatarUrl,

      status: user.status,
      hasAccess: !!user.hasAccess,
      isAdmin: !!user.isAdmin, // ✅ ВАЖНО: возвращаем isAdmin
      
      referral: {
        code: user.refCode,
        directCount: Array.isArray(user.referrals) ? user.referrals.length : 0,
        levels: user.referralLevels,
        balance: user.referralBalance,
        earnedTotal: user.referralEarnedTotal,
      },
      botsCount: Array.isArray(user.bots) ? user.bots.length : 0,
      accessGrantedAt: user.accessGrantedAt ?? null,
      createdAt: user.createdAt,
    };

    console.log("✅ GET /api/me - sending response:", {
      tgId: data.tgId,
      username: data.username,
      hasAccess: data.hasAccess,
      isAdmin: data.isAdmin, // ✅ Логируем isAdmin
      avatarUrl: data.avatarUrl,
    });

    return success(res, { user: data });
  } catch (err) {
    console.error("❌ GET /api/me error:", err);
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

    const query: Record<string, any> = { owner: id };
    if (search) query.$or = [{ username: new RegExp(search, "i") }, { messageText: new RegExp(search, "i") }];
    if (status && ["active", "blocked", "deleted"].includes(status)) query.status = status;

    const [items, total] = await Promise.all([
      Bot.find(query)
        .select("owner username photoUrl messageText interval status groups createdAt")
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean()
        .exec(),
      Bot.countDocuments(query).exec(),
    ]);

    return success(res, {
      items,
      total,
      limit,
      offset,
      userId: id,
      filters: { search: search || undefined, status: query.status || undefined },
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
    const currentUser = res.locals.user as IUser | undefined;
    if (!currentUser) return fail(res, 401, "no_auth");

    const botId = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(botId)) return fail(res, 400, "invalid_id");

    const { chatId, title } = req.body as { chatId?: string | number; title?: string };
    if (!chatId || !title) return fail(res, 400, "missing_fields");

    const bot = await Bot.findById(botId).exec();
    if (!bot) return fail(res, 404, "bot_not_found");

    const isAdmin = (currentUser as any)?.isAdmin === true;
    if (!isAdmin && String(bot.owner) !== String(currentUser._id)) return fail(res, 403, "forbidden");

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
    const currentUser = res.locals.user as IUser | undefined;
    if (!currentUser) return fail(res, 401, "no_auth");

    const botId = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(botId)) return fail(res, 400, "invalid_id");

    const { chatId } = req.body as { chatId?: string | number };
    if (!chatId) return fail(res, 400, "missing_chatId");

    const bot = await Bot.findById(botId).exec();
    if (!bot) return fail(res, 404, "bot_not_found");

    const isAdmin = (currentUser as any)?.isAdmin === true;
    if (!isAdmin && String(bot.owner) !== String(currentUser._id)) return fail(res, 403, "forbidden");

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
   POST /api/bots/create-payment — создать покупку бота (user flow)
   Валидируем поля, создаём TxHistory (pending), отдаём кошелёк+код
========================================= */
router.post("/bots/create-payment", authMiddleware, express.json(), async (req, res) => {
  try {
    const currentUser = res.locals.user as IUser | undefined;
    if (!currentUser) return fail(res, 401, "no_auth");

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
    const intervalValue = Number(interval);
    if (!allowedIntervals.includes(intervalValue)) return fail(res, 400, "bad_interval");

    const BOT_PRICE = Number(process.env.BOT_PRICE ?? 10);
    const BOT_CURRENCY = process.env.BOT_CURRENCY ?? "USDT";
    const CRYPTO_WALLET = process.env.CRYPTO_WALLET || process.env.CRYPTO_WALLET_BOT || "";
    if (!CRYPTO_WALLET) return fail(res, 500, "wallet_not_configured");

    const code12 = generate12DigitCode();
    const transaction = await TxHistory.create({
      user: currentUser._id as unknown as Types.ObjectId,
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
          interval: intervalValue,
          photoUrl: photoUrl === null ? "" : (photoUrl ? String(photoUrl).trim() : ""),
        },
      },
    });

    return success(
      res,
      {
        txId: transaction._id,
        wallet: CRYPTO_WALLET,
        code12,
        amount: BOT_PRICE,
        currency: BOT_CURRENCY,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        note: "Укажите 12-значный код в комментарии/мемо перевода. Проверка может занять до 10 минут.",
      },
      201
    );
  } catch (err) {
    console.error("POST /api/bots/create-payment error", err);
    return fail(res, 500, "internal_error");
  }
});


/* =========================================
   POST /api/bots/create-from-tx/:txId
   Создать бота по записи TxHistory (BOT_PURCHASE)
========================================= */
router.post("/bots/create-from-tx/:txId", authMiddleware, async (req: Request, res: Response) => {
  try {
    const currentUser = res.locals.user as IUser | undefined;
    if (!currentUser) return fail(res, 401, "no_auth");

    const txId = String(req.params.txId ?? "");
    if (!mongoose.isValidObjectId(txId)) return fail(res, 400, "invalid_tx_id");

    const transaction = await TxHistory.findById(txId).exec();
    if (!transaction) return fail(res, 404, "tx_not_found");

    // транзакция должна принадлежать текущему пользователю
    if (String(transaction.user) !== String(currentUser._id)) {
      return fail(res, 403, "forbidden");
    }

    // только покупки бота
    if (transaction.type !== "BOT_PURCHASE") {
      return fail(res, 400, "wrong_tx_type");
    }

    // если уже привязан бот — просто отдаём его
    if (transaction.bot) {
      const existingBot = await Bot.findById(transaction.bot)
        .select("owner username photoUrl messageText interval status groups createdAt")
        .lean()
        .exec();
      return success(res, { bot: existingBot, txId: transaction._id, reused: true });
    }

    // DEV-ЛОГИКА:
    // пока нет реальной проверки блокчейна — если pending, считаем что оплата прошла
    if (transaction.status === "pending") {
      await transaction.markConfirmed(); // метод из модели TxHistory
    }

    if (transaction.status !== "confirmed") {
      return fail(res, 400, "tx_not_confirmed");
    }

    const metaReq = (transaction.meta?.request ?? {}) as any;
    const cleanUsername = String(metaReq.username || "").replace(/^@/, "").trim();
    const messageText = String(metaReq.messageText || "").trim();
    const interval = Number(metaReq.interval || 0);
    const photoUrl =
      metaReq.photoUrl === null
        ? ""
        : metaReq.photoUrl
        ? String(metaReq.photoUrl).trim()
        : "";

    if (!cleanUsername) return fail(res, 400, "bad_username_in_meta");
    if (!messageText) return fail(res, 400, "bad_messageText_in_meta");

    const allowed = [3600, 7200, 10800, 14400, 18000, 21600, 43200, 86400];
    if (!allowed.includes(interval)) return fail(res, 400, "bad_interval_in_meta");

    // создаём бота
    const bot = await Bot.create({
      owner: currentUser._id as any,
      username: cleanUsername,
      photoUrl,
      messageText,
      interval,
      status: "active",
      groups: [],
      chats: [],
      sentCount: 0,
      errorCount: 0,
    });

    // привяжем бота к пользователю
    const freshUser = await User.findById(currentUser._id).exec();
    if (freshUser) {
      freshUser.bots = Array.isArray(freshUser.bots) ? freshUser.bots : [];
      if (!freshUser.bots.some((bId) => String(bId) === String(bot._id))) {
        freshUser.bots.push(bot._id as any);
      }
      await freshUser.save();
    }

    // привяжем бота к транзакции
    transaction.bot = bot._id as any;
    await transaction.save();

    const dto = await Bot.findById(bot._id)
      .select("owner username photoUrl messageText interval status groups createdAt")
      .lean()
      .exec();

    return success(res, { bot: dto, txId: transaction._id }, 201);
  } catch (err) {
    console.error("POST /api/bots/create-from-tx/:txId error", err);
    return fail(res, 500, "internal_error");
  }
});


/* =========================================
   11) POST /api/bots/:id/block — заблокировать бота (владелец/админ)
========================================= */
router.post("/bots/:id/block", authMiddleware, async (req, res) => {
  try {
    const currentUser = res.locals.user as IUser | undefined;
    if (!currentUser) return fail(res, 401, "no_auth");

    const id = String(req.params.id ?? "");
    if (!mongoose.isValidObjectId(id)) return fail(res, 400, "invalid_id");

    const bot = await Bot.findById(id).exec();
    if (!bot) return fail(res, 404, "bot_not_found");

    const isAdmin = (currentUser as any)?.isAdmin === true;
    if (!isAdmin && String(bot.owner) !== String(currentUser._id)) return fail(res, 403, "forbidden");

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
    const currentUser = res.locals.user as IUser | undefined;
    if (!currentUser) return fail(res, 401, "no_auth");

    // ✅ жёстко нормализуем id в строку и используем mongoose.isValidObjectId
    const id = String(req.params.id ?? "");
    if (!mongoose.isValidObjectId(id)) return fail(res, 400, "invalid_id");

    const bot = await Bot.findById(id).exec();
    if (!bot) return fail(res, 404, "bot_not_found");

    const isAdmin = (currentUser as any)?.isAdmin === true;
    if (!isAdmin && String(bot.owner) !== String(currentUser._id)) {
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
    const intervalValue = Number(interval);
    if (!allowed.includes(intervalValue)) return fail(res, 400, "bad_interval");

    // создаём
    const bot = new Bot({
      owner: u._id,
      username: cleanUsername,
      photoUrl: photoUrl === null ? "" : (photoUrl ? String(photoUrl).trim() : ""),
      messageText: String(messageText).trim(),
      interval: intervalValue as any,
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
   - Создаем запись в DeletedBot
   - Удаляем из Bot
   - Убираем из User.bots
========================================= */
router.post("/bots/:id/delete", authMiddleware, async (req, res) => {
  try {
    const currentUser = res.locals.user as IUser | undefined;
    if (!currentUser) return fail(res, 401, "no_auth");

    const id = String(req.params.id ?? "");
    if (!mongoose.isValidObjectId(id)) return fail(res, 400, "invalid_id");

    const bot = await Bot.findById(id).exec();
    if (!bot) return fail(res, 404, "bot_not_found");

    const isAdmin = (currentUser as any)?.isAdmin === true;
    if (!isAdmin && String(bot.owner) !== String(currentUser._id)) {
      return fail(res, 403, "forbidden");
    }

    // Определяем тип удаления
    const deletedByType: "owner" | "admin" = isAdmin ? "admin" : "owner";
    
    // Причина удаления (можно получить из body, если нужно)
    const deletionReason = String(req.body?.reason || "").trim() || undefined;

    // 1) Создаем запись в DeletedBot
    await DeletedBot.createFromBot(
      bot,
      currentUser._id as Types.ObjectId,
      deletedByType,
      deletionReason
    );

    console.log("✅ Bot archived to DeletedBot:", {
      botId: bot._id,
      username: bot.username,
      deletedBy: currentUser._id,
      deletedByType,
    });

    // 2) Удаляем из основной таблицы Bot
    await Bot.findByIdAndDelete(id).exec();

    console.log("✅ Bot removed from main table:", bot._id);

    // 3) Убираем бота из массива User.bots
    const ownerId = bot.owner;
    if (ownerId) {
      const owner = await User.findById(ownerId).exec();
      if (owner) {
        owner.bots = (owner.bots || []).filter((bId) => String(bId) !== String(bot._id));
        await owner.save();
        console.log("✅ Bot removed from User.bots:", owner._id);
      }
    }

    return success(res, { 
      _id: bot._id, 
      deleted: true,
      archived: true,
      message: "Бот успешно удален и архивирован"
    });
  } catch (err) {
    console.error("POST /api/bots/:id/delete error", err);
    return fail(res, 500, "internal_error");
  }
});
/* =========================================
   GET /api/bots/deleted — список удаленных ботов (свои)
========================================= */
router.get("/bots/deleted", authMiddleware, async (req: Request, res: Response) => {
  try {
    const u = res.locals.user as IUser | undefined;
    if (!u) return fail(res, 401, "user_not_found");

    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);

    const [items, total] = await Promise.all([
      DeletedBot.find({ owner: u._id })
        .select("originalBotId username photoUrl deletedAt deletedByType sentCount")
        .sort({ deletedAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean()
        .exec(),
      DeletedBot.countDocuments({ owner: u._id }).exec(),
    ]);

    return success(res, { items, total, limit, offset });
  } catch (err) {
    console.error("GET /api/bots/deleted error", err);
    return fail(res, 500, "internal_error");
  }
});

/* =========================================
   GET /api/bots/deleted/:id — детали удаленного бота
========================================= */
router.get("/bots/deleted/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const u = res.locals.user as IUser | undefined;
    if (!u) return fail(res, 401, "user_not_found");

    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) return fail(res, 400, "invalid_id");

    const isAdmin = (u as any)?.isAdmin === true;

    const bot = await DeletedBot.findById(id).lean().exec();
    
    if (!bot) return fail(res, 404, "bot_not_found");
    
    if (!isAdmin && String(bot.owner) !== String(u._id)) {
      return fail(res, 403, "forbidden");
    }

    return success(res, { bot });
  } catch (err) {
    console.error("GET /api/bots/deleted/:id error", err);
    return fail(res, 500, "internal_error");
  }
});
export default router;
