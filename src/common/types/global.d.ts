import "express";
import { JwtPayload } from "jsonwebtoken";

declare global {
  namespace Express {
    interface Request {
      user?: string | JwtPayload; // сюда кладем результат верификации JWT
    }
  }
}

export {};
