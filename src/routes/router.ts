import type { Request, Response, Router } from "express";
import express from "express";
import admin from "./admin.js";
import auth from "./auth.js";
import api from "./api.js";

const router: Router = express.Router();

router.use("/admin", admin);
router.use("/api/auth", auth);
router.use("/api", api);

router.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ success: true, message: "Server is running" });
});

export default router;
