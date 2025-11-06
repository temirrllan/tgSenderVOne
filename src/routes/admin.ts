// src/routes/admin.ts
import express, { type Request, type Response, type Router, type NextFunction } from "express";
import mongoose, { Types } from "mongoose";
import authMiddleware from "../middlewares/authMiddleware.js";
import { adminOnly } from "../middlewares/adminOnly.middleware.js";

import { User } from "../common/mongo/Models/User.js";
import { Bot } from "../common/mongo/Models/Bot.js";
import type { BotStatus } from "../common/mongo/Models/Bot.js";
import { Group } from "../common/mongo/Models/Group.js";
import logAdminAction from "../common/utils/logAdminAction.js";

const router: Router = express.Router();

/* ──────────────────────────────────────────
   Унифицированные ответы
   ────────────────────────────────────────── */
function success(res: Response, data: unknown, status = 200, message = "success sosal") {
  return res.status(status).json({ status, message, data });
}
function fail(res: Response, status = 400, message = "error") {
  return res.status(status).json({ status, message });
}

// helper-обёртка, чтобы не писать try/catch в каждой ручке
const asyncWrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch((e) => {
      console.error("admin route error:", e);
      return fail(res, 500, "internal_error");
    });

/* ──────────────────────────────────────────
   Защита: авторизация → проверка прав админа
   ────────────────────────────────────────── */
router.use(authMiddleware);
router.use(adminOnly);

/* ===============================
   GET /api/admin — страница админки (EJS)
   =============================== */
router.get("/", (_req: Request, res: Response) => {
  res.render("admin/main", { title: "Admin Panel" });
});

/* ===============================
   1) GET /api/admin/users — список всех юзеров
   ?limit=<1..200>&offset=<0..>
   =============================== */
router.get(
  "/users",
  asyncWrap(async (req: Request, res: Response) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);

    const [items, total] = await Promise.all([
      User.find({})
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean()
        .exec(),
      User.countDocuments().exec(),
    ]);

    return success(res, { items, total, limit, offset });
  })
);

/* ===============================
   2) POST /api/admin/users/:id — данные конкретного юзера
   =============================== */
router.post(
  "/users/:id",
  asyncWrap(async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    if (!mongoose.isValidObjectId(id)) return fail(res, 400, "invalid_id");

    const user = await User.findById(id).lean().exec();
    if (!user) return fail(res, 404, "user_not_found");

    const [botsCount, directReferrals] = await Promise.all([
      Bot.countDocuments({ owner: user._id }).exec(),
      User.countDocuments({ invitedBy: user._id }).exec(),
    ]);

    return success(res, {
      user,
      stats: { botsCount, directReferrals },
    });
  })
);

/* ===============================
   3) POST /api/admin/users/:id/block — заблокировать юзера
   =============================== */
router.post(
  "/users/:id/block",
  asyncWrap(async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    if (!mongoose.isValidObjectId(id)) return fail(res, 400, "invalid_id");

    const user = await User.findById(id).exec();
    if (!user) return fail(res, 404, "user_not_found");

    if (user.status === "blocked") {
      return success(res, { _id: user._id, status: user.status }, 200, "already_blocked");
    }

    user.status = "blocked";
    await user.save();
    return success(res, { _id: user._id, status: user.status });
  })
);

/* ===============================
   4) GET /api/admin/users/:id/unblock — разблокировать юзера
   =============================== */
router.get(
  "/users/:id/unblock",
  asyncWrap(async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    if (!mongoose.isValidObjectId(id)) return fail(res, 400, "invalid_id");

    const user = await User.findById(id).exec();
    if (!user) return fail(res, 404, "user_not_found");

    if (user.status === "active") {
      return success(res, { _id: user._id, status: user.status }, 200, "already_active");
    }

    user.status = "active";
    await user.save();
    return success(res, { _id: user._id, status: user.status });
  })
);

/* ===============================
   5) GET /api/admin/bots — все боты (пагинация/поиск)
   ?limit=50&offset=0&search=&ownerId=<userId?>
   =============================== */
router.get(
  "/bots",
  asyncWrap(async (req: Request, res: Response) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const search = String(req.query.search ?? "").trim();
    const ownerId = String(req.query.ownerId ?? "").trim();

    const q: Record<string, any> = {};
    if (ownerId && mongoose.isValidObjectId(ownerId)) q.owner = ownerId;
    if (search) {
      q.$or = [
        { username: new RegExp(search, "i") },
        { messageText: new RegExp(search, "i") },
      ];
    }

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

    return success(res, { items, total, limit, offset });
  })
);

/* ===============================
   6) POST /api/admin/bots/:id/update — обновить бота (админ)
   Разрешено: username, photoUrl, messageText, interval, status, ownerId
   =============================== */
router.post(
  "/bots/:id/update",
  express.json(),
  asyncWrap(async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    if (!mongoose.isValidObjectId(id)) return fail(res, 400, "invalid_id");

    const bot = await Bot.findById(id).exec();
    if (!bot) return fail(res, 404, "bot_not_found");

    const { username, photoUrl, messageText, interval, status, ownerId } = req.body as Partial<{
      username: string;
      photoUrl: string | null;
      messageText: string;
      interval: number | string;
      status: BotStatus | string;
      ownerId: string;
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

    if (typeof status !== "undefined") {
      const s = String(status);
      const allowedStatuses = ["active", "blocked", "deleted"];
      if (!allowedStatuses.includes(s)) return fail(res, 400, "bad_status");
      (bot as any).status = s as any;
    }

    if (typeof ownerId !== "undefined") {
      if (!mongoose.isValidObjectId(ownerId)) return fail(res, 400, "bad_ownerId");
      const newOwner = await User.findById(ownerId).exec();
      if (!newOwner) return fail(res, 404, "owner_not_found");

      // перекидываем бота между владельцами
      const oldOwner = await User.findById(bot.owner as unknown as Types.ObjectId).exec();
      (bot as any).owner = newOwner._id as unknown as Types.ObjectId;

      if (oldOwner) {
        oldOwner.bots = (oldOwner.bots || []).filter((bId) => String(bId) !== String(bot._id));
        await oldOwner.save();
      }
      newOwner.bots = Array.isArray(newOwner.bots) ? newOwner.bots : [];
      if (!newOwner.bots.some((bId) => String(bId) === String(bot._id))) {
        newOwner.bots.push(bot._id as any);
        await newOwner.save();
      }
    }

    await bot.save();

    const dto = await Bot.findById(bot._id)
      .select("owner username photoUrl messageText interval status groups createdAt")
      .lean()
      .exec();

    return success(res, { bot: dto });
  })
);

/* ===============================
   7) POST /api/admin/bots/:id/block — блокировать бота
   Идемпотентно: если уже blocked — 200 "already_blocked"
   =============================== */
router.post(
  "/bots/:id/block",
  asyncWrap(async (req, res) => {
    const id = String(req.params.id ?? "");
    if (!mongoose.isValidObjectId(id)) return fail(res, 400, "invalid_id");

    const bot = await Bot.findById(id).exec();
    if (!bot) return fail(res, 404, "bot_not_found");

    if ((bot as any).status === "blocked") {
      return success(res, { _id: bot._id, status: (bot as any).status }, 200, "already_blocked");
    }

    (bot as any).status = "blocked";
    await bot.save();

    return success(res, { _id: bot._id, status: (bot as any).status });
  })
);

/* ===============================
   8) POST /api/admin/bots/:id/unblock — разблокировать бота
   Идемпотентно: если уже active — 200 "already_active"
   =============================== */
router.post(
  "/bots/:id/unblock",
  asyncWrap(async (req, res) => {
    const id = String(req.params.id ?? "");
    if (!mongoose.isValidObjectId(id)) return fail(res, 400, "invalid_id");

    const bot = await Bot.findById(id).exec();
    if (!bot) return fail(res, 404, "bot_not_found");

    if ((bot as any).status === "active") {
      return success(res, { _id: bot._id, status: (bot as any).status }, 200, "already_active");
    }

    (bot as any).status = "active";
    await bot.save();

    return success(res, { _id: bot._id, status: (bot as any).status });
  })
);

/* ===============================
   9) POST /api/admin/bots/:id/delete — удалить бота (soft)
   Логика:
     - ставим status="deleted"
     - убираем бота из массива owner.bots
   =============================== */
router.post(
  "/bots/:id/delete",
  asyncWrap(async (req, res) => {
    const id = String(req.params.id ?? "");
    if (!mongoose.isValidObjectId(id)) return fail(res, 400, "invalid_id");

    const bot = await Bot.findById(id).exec();
    if (!bot) return fail(res, 404, "bot_not_found");

    if ((bot as any).status === "deleted") {
      return success(res, { _id: bot._id, status: (bot as any).status }, 200, "already_deleted");
    }

    const ownerId = (bot as any).owner;
    (bot as any).status = "deleted";
    await bot.save();

    if (ownerId) {
      const owner = await User.findById(ownerId).exec();
      if (owner) {
        owner.bots = (owner.bots || []).filter((bId) => String(bId) !== String(bot._id));
        await owner.save();
      }
    }

    return success(res, { _id: bot._id, status: (bot as any).status });
  })
);

/* ===============================
   POST /api/admin/bots/:id/groups/add
   =============================== */
router.post(
  "/bots/:id/groups/add",
  express.json(),
  asyncWrap(async (req, res) => {
    const botId = String(req.params.id ?? "");
    if (!mongoose.isValidObjectId(botId)) return fail(res, 400, "invalid_id");

    const { chatId, title } = req.body as { chatId?: string | number; title?: string };
    if (!chatId || !title) return fail(res, 400, "missing_fields");

    const bot = await Bot.findById(botId).exec();
    if (!bot) return fail(res, 404, "bot_not_found");

    // создаём/находим группу (отдельная коллекция)
    const group = await Group.findOneAndUpdate(
      { chatId: String(chatId) },
      { $setOnInsert: { chatId: String(chatId), title: String(title) } },
      { new: true, upsert: true }
    ).lean();

    const before = bot.groups?.length ?? 0;

    // если уже добавлена — не дублируем
    const already = (bot.groups ?? []).some((g: any) => String(g) === String(group._id));
    if (!already) {
      bot.groups = ([...(bot.groups ?? []), group._id as any]) as any;
      await bot.save();
    }
    const after = bot.groups?.length ?? 0;

    // лог
    const admin = res.locals.user;
    await logAdminAction({
      adminId: (admin?._id as Types.ObjectId) ?? undefined,
      targetType: "bot",
      targetId: bot._id as unknown as Types.ObjectId,
      action: "groups:add",
      meta: { chatId: String(chatId), title: String(title) },
    });

    return success(res, {
      botId: bot._id,
      added: after !== before,
      group: { _id: group._id, chatId: group.chatId, title: group.title },
      groupsCount: after,
    });
  })
);

/* ===============================
   POST /api/admin/bots/:id/groups/delete
   =============================== */
router.post(
  "/bots/:id/groups/delete",
  express.json(),
  asyncWrap(async (req, res) => {
    const botId = String(req.params.id ?? "");
    if (!mongoose.isValidObjectId(botId)) return fail(res, 400, "invalid_id");

    const { chatId } = req.body as { chatId?: string | number };
    if (!chatId) return fail(res, 400, "missing_chatId");

    const bot = await Bot.findById(botId).exec();
    if (!bot) return fail(res, 404, "bot_not_found");

    const group = await Group.findOne({ chatId: String(chatId) }).lean();
    if (!group) return fail(res, 404, "group_not_found");

    const before = bot.groups?.length ?? 0;
    bot.groups = (bot.groups ?? []).filter((g: any) => String(g) !== String(group._id)) as any;
    const after = bot.groups?.length ?? 0;
    if (before === after) return fail(res, 404, "group_not_found");

    await bot.save();

    // лог
    const admin = res.locals.user;
    await logAdminAction({
      adminId: (admin?._id as Types.ObjectId) ?? undefined,
      targetType: "bot",
      targetId: bot._id as unknown as Types.ObjectId,
      action: "groups:delete",
      meta: { chatId: String(chatId) },
    });

    return success(res, {
      botId: bot._id,
      deletedChatId: String(chatId),
      groupsCount: after,
    });
  })
);

/* ===============================
   10) POST /api/admin/bots/create — создать бота (вручную)
   Body: { ownerId, username, messageText, interval, photoUrl?, status? }
   =============================== */
router.post(
  "/bots/create",
  express.json(),
  asyncWrap(async (req: Request, res: Response) => {
    const { ownerId, username, messageText, interval, photoUrl, status } = req.body as Partial<{
      ownerId: string;
      username: string;
      messageText: string;
      interval: number | string;
      photoUrl: string | null;
      status: BotStatus | string;
    }>;

    // валидация
    if (!ownerId || !mongoose.isValidObjectId(ownerId)) return fail(res, 400, "bad_ownerId");
    if (!username) return fail(res, 400, "bad_username");
    if (!messageText) return fail(res, 400, "bad_messageText");
    if (typeof interval === "undefined") return fail(res, 400, "bad_interval");

    const owner = await User.findById(ownerId).exec();
    if (!owner) return fail(res, 404, "owner_not_found");

    const cleanUsername = String(username).replace(/^@/, "").trim();
    if (!cleanUsername) return fail(res, 400, "bad_username");

    const allowedIntervals = [3600, 7200, 10800, 14400, 18000, 21600, 43200, 86400]; // сек
    const iv = Number(interval);
    if (!allowedIntervals.includes(iv)) return fail(res, 400, "bad_interval");

    // статус опционально
    const s = status ? String(status) : "active";
    const allowedStatuses = ["active", "blocked", "deleted"];
    if (!allowedStatuses.includes(s)) return fail(res, 400, "bad_status");

    // создаём
    const bot = new Bot({
      owner: owner._id,
      username: cleanUsername,
      photoUrl: photoUrl === null ? "" : (photoUrl ? String(photoUrl).trim() : ""),
      messageText: String(messageText).trim(),
      interval: iv as any,            // прошёл валидацию
      status: s as any,               // прошёл валидацию
      groups: [],
      chats: [],
    });

    await bot.save();

    // привяжем к владельцу
    owner.bots = Array.isArray(owner.bots) ? owner.bots : [];
    if (!owner.bots.some((bId) => String(bId) === String(bot._id))) {
      owner.bots.push(bot._id as any);
      await owner.save();
    }

    const dto = await Bot.findById(bot._id)
      .select("owner username photoUrl messageText interval status groups createdAt")
      .lean()
      .exec();

    return success(res, { bot: dto }, 201);
  })
);

export default router;
