// src/routes/auth.ts
import express, { type Request, type Response } from "express";
import crypto from "crypto";
import jwt, { type SignOptions, type Secret } from "jsonwebtoken";
import { Types } from "mongoose";
import { User, type IUser } from "../models/User.js";

const router = express.Router();

/* ============================
   CONFIG
============================ */
const NODE_ENV = process.env.NODE_ENV || "development";
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const COMPANY_NAME = process.env.COMPANY_NAME || "Sender";
const AUTH_COOKIE = process.env.AUTH_COOKIE || "token";
const TG_INITDATA_MAX_AGE = Number(process.env.TG_INITDATA_MAX_AGE ?? 60); // сек
const JWT_SECRET: Secret = (process.env.JWT_SECRET ?? "change_me_secret") as Secret;

type ExpiresIn = NonNullable<SignOptions["expiresIn"]>;
const JWT_EXPIRES_IN: ExpiresIn =
  (process.env.JWT_TTL as ExpiresIn) || ("30d" as ExpiresIn);

/* ============================
   TYPES
============================ */
interface TelegramInitUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}
interface TelegramParsed {
  user: TelegramInitUser;
  obj: Record<string, string>;
}
interface AuthBody {
  initData?: string;   // Telegram WebApp initData (raw string)
  ref?: string;        // рефкод или tgId пригласителя (опц.)
}

/* ============================
   COMMON RESPONSE HELPERS
============================ */
function success(res: Response, data: unknown, status = 200, message = "success sosal") {
  return res.status(status).json({ status, message, data });
}
function fail(res: Response, status = 400, message = "error") {
  return res.status(status).json({ status, message });
}

/* ============================
   HELPERS
============================ */
function buildCheckString(obj: Record<string, string>): string {
  return Object.keys(obj)
    .sort()
    .map((k) => `${k}=${obj[k]}`)
    .join("\n");
}

function verifyTelegramInitData(initData: string, botToken: string): TelegramParsed {
  if (!botToken) throw new Error("BOT_TOKEN not set");

  const data = new URLSearchParams(initData);
  const obj: Record<string, string> = {};
  for (const [k, v] of data.entries()) obj[k] = v;

  const hash = obj.hash;
  if (!hash) throw new Error("init_data_invalid");
  delete obj.hash;

  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const checkStr = buildCheckString(obj);
  const sign = crypto.createHmac("sha256", secret).update(checkStr).digest("hex");
  if (sign !== hash) throw new Error("init_data_invalid");

  const authDate = Number(obj.auth_date || 0);
  // age check in seconds
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > TG_INITDATA_MAX_AGE) {
    throw new Error("init_data_expired");
  }

  const userRaw = obj.user;
  const user = userRaw ? (JSON.parse(userRaw) as TelegramInitUser) : null;
  if (!user) throw new Error("user_missing");

  return { user, obj };
}

function issueToken(user: IUser): string {
  if (!JWT_SECRET) throw new Error("JWT_SECRET not set");
  const payload = { sub: String(user._id), tgId: user.tgId };
  const options: SignOptions = { expiresIn: JWT_EXPIRES_IN };
  return jwt.sign(payload, JWT_SECRET, options);
}

function setAuthCookie(res: Response, token: string): void {
  const isProd = NODE_ENV === "production";
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 дней
  });
}

function clearAuthCookie(res: Response): void {
  const isProd = NODE_ENV === "production";
  res.clearCookie(AUTH_COOKIE, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
  });
}

async function ensureDevUserAccount(): Promise<IUser> {
  const devId = 1001;
  let user = await User.findOne({ tgId: devId }).exec();
  if (!user) {
    user = await User.create({
      tgId: devId,
      username: "dev_user",
      firstName: "Dev",
      lastName: "User",
      hasAccess: true,
    });
  }
  return user;
}

/* ============================
   ROUTES
============================ */

/**
 * POST /api/auth/telegram
 * Принимает initData из Telegram WebApp, валидирует подпись,
 * создаёт/обновляет пользователя и возвращает JWT.
 */
router.post(
  "/telegram",
  express.json(),
  async (req: Request<unknown, unknown, AuthBody>, res: Response) => {
    try {
      if (!BOT_TOKEN || !JWT_SECRET) {
        return fail(res, 500, "server_misconfigured");
      }

      const { initData, ref } = req.body ?? {};

      // DEV fallback без initData
      if (!initData) {
        if (NODE_ENV === "production") {
          return fail(res, 400, "init_data_required");
        }
        const devUser = await ensureDevUserAccount();
        const devToken = issueToken(devUser);
        setAuthCookie(res, devToken);
        return success(
          res,
          {
            token: devToken,
            user: {
              tgId: devUser.tgId,
              username: devUser.username,
              firstName: devUser.firstName,
              lastName: devUser.lastName,
              hasAccess: devUser.hasAccess,
              refCode: devUser.refCode,
            },
            company: COMPANY_NAME,
            dev: true,
          },
          200
        );
      }

      // Нормальная авторизация через Telegram initData
      const parsed = verifyTelegramInitData(initData, BOT_TOKEN);
      const tg = parsed.user;

      // если пришёл ref — найдём пригласителя (по refCode или tgId)
      let inviter: IUser | null = null;
      if (ref && String(ref) !== String(tg.id)) {
        const maybeTgId = /^\d+$/.test(ref) ? Number(ref) : undefined;
        inviter = await User.findOne(
          maybeTgId != null ? { $or: [{ refCode: ref }, { tgId: maybeTgId }] } : { refCode: ref }
        ).exec();
      }

      // пригласитель (ObjectId)
      const inviterId: Types.ObjectId | undefined = inviter
        ? (inviter._id as unknown as Types.ObjectId)
        : undefined;

      // создать/обновить пользователя
      let user = await User.findOne({ tgId: tg.id }).exec();
      if (user) {
        user.username = tg.username ?? user.username ?? "";
        user.firstName = tg.first_name ?? user.firstName ?? "";
        user.lastName = tg.last_name ?? user.lastName ?? "";

        if (!user.invitedBy && inviterId && !(user._id as unknown as Types.ObjectId).equals(inviterId)) {
          user.invitedBy = inviterId;
        }
        await user.save();
      } else {
        user = await User.create({
          tgId: tg.id,
          username: tg.username ?? "",
          firstName: tg.first_name ?? "",
          lastName: tg.last_name ?? "",
          invitedBy: inviterId,
        });
      }

      const token = issueToken(user);
      setAuthCookie(res, token);

      return success(
        res,
        {
          token,
          user: {
            tgId: user.tgId,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            hasAccess: user.hasAccess,
            refCode: user.refCode,
          },
          company: COMPANY_NAME,
        },
        200
      );
    } catch (err) {
      console.error("POST /api/auth/telegram error:", err);
      return fail(res, 400, "invalid_init_data");
    }
  }
);

/** POST /api/auth/logout — сброс cookie */
router.post("/logout", (_req: Request, res: Response) => {
  clearAuthCookie(res);
  return success(res, { ok: true }, 200);
});

export default router;
