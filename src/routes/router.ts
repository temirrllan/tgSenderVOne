import type { Request, Response, Router } from "express";
import express from "express";
import admin from "./admin.js";

const router: Router = express.Router();
router.use("/admin", admin);

router.get("/", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "Server is running",
  });
  return;
});

export default router;
