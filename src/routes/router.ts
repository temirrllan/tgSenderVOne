// src/routes/router.ts
import type { Request, Response, Router } from "express";
import express from "express";
import admin from "./admin.js";
import auth from "./auth.js";
import api from "./api.js";  // ← этот роут содержит GET /me

const router: Router = express.Router();

// ✅ Логируем все входящие запросы
router.use((req, res, next) => {
  console.log("📍 [ROUTER] Incoming:", {
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl
  });
  next();
});

router.use("/api/auth", auth);
router.use("/api/admin", admin);
router.use("/api", api);  // ← GET /me находится здесь

router.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ 
    status: 200, 
    message: "success", 
    data: { alive: true } 
  });
});

export default router;