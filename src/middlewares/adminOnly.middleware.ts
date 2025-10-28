// src/middlewares/adminOnly.middleware.ts
import type { Request, Response, NextFunction } from "express";
import { User } from "../common/mongo/Models/User.js";

/*
  Проверка прав администратора.
  Работает только после authMiddleware.
*/

export async function adminOnly(
  req: Request & { user?: any },
  res: Response,
  next: NextFunction
) {
  try {
    const user = req.user || (res.locals as any).user;
    if (!user) {
      return res
        .status(401)
        .json({ ok: false, error: "not_authenticated" });
    }

    const freshUser = await User.findById(user._id).lean().exec();
    if (!freshUser || !freshUser.isAdmin) {
      return res.status(403).json({
        ok: false,
        error: "not_admin",
        message: "Доступ запрещён. Нужны права администратора.",
      });
    }

    next();
  } catch (err) {
    console.error("adminOnly error", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
}
