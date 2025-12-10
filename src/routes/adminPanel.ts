// backend/src/routes/adminPanel.ts
import express, { type Request, type Response, type Router } from "express";
import mongoose from "mongoose";
import { adminAuthMiddleware } from "../middlewares/adminAuth.middleware.js";
import { User } from "../models/User.js";
import { Bot } from "../models/Bot.js";
import { DeletedBot } from "../models/DeletedBot.js";

const router: Router = express.Router();

// Применяем middleware ко всем роутам
router.use(adminAuthMiddleware);

/* ──────────────────────────────────────────
   Helpers
   ────────────────────────────────────────── */
function success(res: Response, data: unknown, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res: Response, status = 400, message = "error") {
  return res.status(status).json({ success: false, error: message });
}

/* ──────────────────────────────────────────
   Профиль текущего админа
   ────────────────────────────────────────── */
router.get("/me", async (_req: Request, res: Response) => {
  try {
    const admin = res.locals.admin;
    
    return success(res, {
      admin: {
        tgId: admin.tgId,
        username: admin.username,
        firstName: admin.firstName,
        lastName: admin.lastName,
        avatarUrl: admin.avatarUrl,
        isAdmin: admin.isAdmin,
        createdAt: admin.createdAt,
      }
    });
  } catch (err) {
    console.error("GET /admin-panel/me error:", err);
    return fail(res, 500, "internal_error");
  }
});

/* ──────────────────────────────────────────
   Статистика (дашборд)
   ────────────────────────────────────────── */
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const [
      totalUsers,
      activeUsers,
      usersWithAccess,
      totalBots,
      activeBots,
      deletedBots,
      totalAdmins,
    ] = await Promise.all([
      User.countDocuments().exec(),
      User.countDocuments({ status: "active" }).exec(),
      User.countDocuments({ hasAccess: true }).exec(),
      Bot.countDocuments().exec(),
      Bot.countDocuments({ status: "active" }).exec(),
      DeletedBot.countDocuments().exec(),
      User.countDocuments({ isAdmin: true }).exec(),
    ]);

    return success(res, {
      users: {
        total: totalUsers,
        active: activeUsers,
        withAccess: usersWithAccess,
      },
      bots: {
        total: totalBots,
        active: activeBots,
        deleted: deletedBots,
      },
      admins: {
        total: totalAdmins,
      }
    });
  } catch (err) {
    console.error("GET /admin-panel/stats error:", err);
    return fail(res, 500, "internal_error");
  }
});

/* ──────────────────────────────────────────
   Список пользователей
   ────────────────────────────────────────── */
router.get("/users", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const search = String(req.query.search ?? "").trim();
    const status = String(req.query.status ?? "").trim();

    const query: Record<string, any> = {};
    
    if (search) {
      query.$or = [
        { username: new RegExp(search, "i") },
        { firstName: new RegExp(search, "i") },
        { tgId: isNaN(Number(search)) ? undefined : Number(search) },
      ].filter(f => f.tgId !== undefined);
    }
    
    if (status && ["active", "blocked", "pending"].includes(status)) {
      query.status = status;
    }

    const [items, total] = await Promise.all([
      User.find(query)
        .select("tgId username firstName lastName status hasAccess isAdmin createdAt")
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean()
        .exec(),
      User.countDocuments(query).exec(),
    ]);

    return success(res, { items, total, limit, offset });
  } catch (err) {
    console.error("GET /admin-panel/users error:", err);
    return fail(res, 500, "internal_error");
  }
});

/* ──────────────────────────────────────────
   Детали пользователя
   ────────────────────────────────────────── */
router.get("/users/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "");
    if (!mongoose.isValidObjectId(id)) {
      return fail(res, 400, "invalid_id");
    }

    const user = await User.findById(id).lean().exec();
    if (!user) {
      return fail(res, 404, "user_not_found");
    }

    const [botsCount, directReferrals] = await Promise.all([
      Bot.countDocuments({ owner: user._id }).exec(),
      User.countDocuments({ invitedBy: user._id }).exec(),
    ]);

    return success(res, {
      user,
      stats: { botsCount, directReferrals }
    });
  } catch (err) {
    console.error("GET /admin-panel/users/:id error:", err);
    return fail(res, 500, "internal_error");
  }
});

/* ──────────────────────────────────────────
   Список ботов
   ────────────────────────────────────────── */
router.get("/bots", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const search = String(req.query.search ?? "").trim();
    const status = String(req.query.status ?? "").trim();

    const query: Record<string, any> = {};
    
    if (search) {
      query.$or = [
        { username: new RegExp(search, "i") },
        { messageText: new RegExp(search, "i") },
      ];
    }
    
    if (status && ["awaiting_payment", "active", "blocked", "deleted"].includes(status)) {
      query.status = status;
    }

    const [items, total] = await Promise.all([
      Bot.find(query)
        .populate("owner", "tgId username firstName")
        .select("owner username photoUrl status sentCount errorCount createdAt")
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean()
        .exec(),
      Bot.countDocuments(query).exec(),
    ]);

    return success(res, { items, total, limit, offset });
  } catch (err) {
    console.error("GET /admin-panel/bots error:", err);
    return fail(res, 500, "internal_error");
  }
});

/* ──────────────────────────────────────────
   Детали бота
   ────────────────────────────────────────── */
router.get("/bots/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "");
    if (!mongoose.isValidObjectId(id)) {
      return fail(res, 400, "invalid_id");
    }

    const bot = await Bot.findById(id)
      .populate("owner", "tgId username firstName")
      .lean()
      .exec();

    if (!bot) {
      return fail(res, 404, "bot_not_found");
    }

    return success(res, { bot });
  } catch (err) {
    console.error("GET /admin-panel/bots/:id error:", err);
    return fail(res, 500, "internal_error");
  }
});

/* ──────────────────────────────────────────
   Список удаленных ботов
   ────────────────────────────────────────── */
router.get("/bots/deleted", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);

    const [items, total] = await Promise.all([
      DeletedBot.find()
        .populate("owner", "tgId username firstName")
        .populate("deletedBy", "tgId username firstName")
        .select("username deletedAt deletedByType sentCount errorCount")
        .sort({ deletedAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean()
        .exec(),
      DeletedBot.countDocuments().exec(),
    ]);

    return success(res, { items, total, limit, offset });
  } catch (err) {
    console.error("GET /admin-panel/bots/deleted error:", err);
    return fail(res, 500, "internal_error");
  }
});

export default router;