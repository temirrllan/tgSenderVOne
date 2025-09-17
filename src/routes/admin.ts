import type { Request, Response, Router } from "express";
import express from "express";

const admin: Router = express.Router();

admin.get("/", (req: Request, res: Response) => {
  res.render("admin/main", { title: "Admin Panel" });
  return;
});

export default admin;
