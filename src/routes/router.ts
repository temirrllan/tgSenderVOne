// src/routes/router.ts
import type { Request, Response, Router } from "express";
import express from "express";
import admin from "./admin.js";
import auth from "./auth.js";
import api from "./api.js";

const router: Router = express.Router();

/**
 * Итоговые пути:
 * - /api/auth/telegram    (POST)
 * - /api/auth/logout      (POST)
 * - /api/...              (твои пользовательские API)
 * - /api/admin/...        (админка)
 */
router.use("/api/auth", auth);
router.use("/api/admin", admin);
router.use("/api", api);

router.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ status: 200, message: "success sosal", data: { alive: true } });
});

export default router;
