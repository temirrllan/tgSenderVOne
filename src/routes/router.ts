// src/routes/router.ts
import type { Request, Response, Router } from "express";
import express from "express";
import admin from "./admin.js";
import auth from "./auth.js"; // <-- auth routes (must be before api)
import api from "./api.js";

const router: Router = express.Router();

// Admin panel
router.use("/admin", admin);

// Auth (telegram login / webapp)
router.use("/api/auth", auth);

// Main API (protected endpoints)
router.use("/api", api);

router.get("/", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "Server is running",
  });
  return;
});

export default router;
