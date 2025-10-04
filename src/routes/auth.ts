// src/routes/auth.ts
import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import querystring from "querystring";
import type { Request, Response } from "express";
import { User } from "../common/mongo/Models/User.js";

const router = express.Router();

function buildDataCheckString(obj: Record<string, any>) {
  const keys = Object.keys(obj).sort();
  return keys.map((k) => `${k}=${obj[k]}`).join("\n");
}

router.post("/telegram", express.json(), async (req: Request, res: Response) => {
  try {
    const botToken = process.env.BOT_TOKEN;
    const jwtSecret = process.env.JWT_SECRET;
    if (!botToken || !jwtSecret) return res.status(500).json({ ok: false, error: "server_misconfigured" });

    // Принять auth_data объект OR initData строку
    let authData: Record<string, any> | null = null;
    if (req.body?.auth_data) {
      authData = req.body.auth_data;
    } else if (req.body?.initData) {
      const parsed = querystring.parse(String(req.body.initData));
      authData = {};
      for (const k of Object.keys(parsed)) {
        const v = parsed[k];
        authData[k] = Array.isArray(v) ? v[0] : v;
      }
    } else {
      authData = req.body;
    }

    if (!authData || !authData.hash) {
      return res.status(400).json({ ok: false, error: "missing_auth_data" });
    }

    // проверка времени (фрешнесс)
    const authDate = Number(authData.auth_date || 0);
    const nowSec = Math.floor(Date.now() / 1000);
    const maxAge = 24 * 60 * 60; // 24 часа (можно уменьшить)
    if (authDate <= 0 || Math.abs(nowSec - authDate) > maxAge) {
      return res.status(401).json({ ok: false, error: "auth_data_too_old" });
    }

    // проверка подписи
    const data: Record<string, any> = { ...authData };
    const receivedHash = String(data.hash);
    delete data.hash;
    const data_check_string = buildDataCheckString(data);

    const secret_key = crypto.createHash("sha256").update(String(botToken)).digest();
    const hmac = crypto.createHmac("sha256", secret_key).update(data_check_string).digest("hex");

    const a = Buffer.from(hmac, "hex");
    let b: Buffer;
    try {
      b = Buffer.from(receivedHash, "hex");
    } catch (e) {
      return res.status(401).json({ ok: false, error: "invalid_hash_format" });
    }
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ ok: false, error: "invalid_auth_signature" });
    }

    // find or create user
    const tgId = Number(authData.id);
    if (!tgId) return res.status(400).json({ ok: false, error: "invalid_id" });

    let user = await User.findOne({ tgId }).exec();

    if (!user) {
      // создаём если нет
      const created = new User({
        tgId,
        tgName: [authData.first_name, authData.last_name].filter(Boolean).join(" ") || authData.username || String(tgId),
        tgUsername: authData.username || "",
        tgImage: authData.photo_url || "",
        createdAt: new Date(),
      } as any);
      await created.save();
      user = created;
    } else {
      // Обновляем профильные поля (не трогаем phone/ref и т.д.)
      const update: any = {};
      if (authData.photo_url && authData.photo_url !== user.tgImage) update.tgImage = authData.photo_url;
      if (authData.username && authData.username !== user.tgUsername) update.tgUsername = authData.username;
      const newName = [authData.first_name, authData.last_name].filter(Boolean).join(" ");
      if (newName && newName !== user.tgName) update.tgName = newName;

      if (Object.keys(update).length) {
        await User.updateOne({ _id: user._id }, { $set: update }).exec();
        // перезагрузим пользователя из БД, чтобы иметь актуальные поля и правильные типы
        const reloaded = await User.findById(user._id).exec();
        if (!reloaded) {
          // очень редкая ситуация —:(
          return res.status(500).json({ ok: false, error: "user_reload_failed" });
        }
        user = reloaded;
      }
    }

    // На этом моменте user гарантированно не null — добавлена явная проверка выше
    if (!user) {
      return res.status(500).json({ ok: false, error: "user_missing_after_create" });
    }

    // Формирование JWT
    const payload = { tgId: user.tgId, uid: String(user._id) };
    const token = jwt.sign(payload, String(jwtSecret), { expiresIn: "30d" });

    // prepare safeUser для ответа
    const safeUser = {
      tgId: user.tgId,
      tgName: user.tgName ?? null,
      tgUsername: user.tgUsername ?? null,
      tgImage: user.tgImage ?? null,
      phone: (user as any).phone ?? null,
      balance: (user as any).balance ?? 0,
      ref: (user as any).ref ?? null,
    };

    return res.json({ ok: true, token, user: safeUser });
  } catch (err) {
    console.error("POST /api/auth/telegram error:", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
