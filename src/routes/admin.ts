// src/routes/admin.ts
import express, { type Request, type Response, type Router, type NextFunction } from "express";
import mongoose from "mongoose";
import authMiddleware from "../middlewares/authMiddleware.js";
import { adminOnly } from "../middlewares/adminOnly.middleware.js";
import { User } from "../common/mongo/Models/User.js";
import { Bot } from "../common/mongo/Models/Bot.js";

const router: Router = express.Router();

/* ──────────────────────────────────────────
   Унифицированные ответы (единый формат)
   ────────────────────────────────────────── */
function success(res: Response, data: unknown, status = 200, message = "success") {
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
   1) GET /api/users — список всех юзеров
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
   2) POST /api/users/:id — данные конкретного юзера
   =============================== */
router.post(
  "/users/:id",
  asyncWrap(async (req: Request, res: Response) => {
    const id = req.params.id as string;

    // Проверка: валидный ObjectId?
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return fail(res, 400, "invalid_id");
    }

    // Находим юзера
    const user = await User.findById(id).lean().exec();
    if (!user) {
      return fail(res, 404, "user_not_found");
    }

    // Собираем доп. статистику
    const [botsCount, directReferrals] = await Promise.all([
      Bot.countDocuments({ owner: user._id }).exec(),
      User.countDocuments({ invitedBy: user._id }).exec(),
    ]);

    // Отправляем в едином формате
    return success(res, {
      user,
      stats: {
        botsCount,
        directReferrals,
      },
    });
  })
);


export default router;
