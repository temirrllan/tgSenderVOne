// src/utils/logAdminAction.ts
import { Types } from "mongoose";

export type LogParams = {
  adminId: Types.ObjectId;
  targetType: "user" | "bot";
  targetId: string | Types.ObjectId; // ← принимаем и строку, и ObjectId
  action: string;                     // например: "groups:add", "groups:delete"
  meta?: Record<string, any>;         // любые дополнительные данные
};

/**
 * Простой логгер админ-действий.
 * Сейчас — консоль. Позже легко заменить на запись в БД (TxHistory и т.п.).
 */
export default function logAdminAction(params: LogParams) {
  try {
    // здесь можно сделать реальную запись в коллекцию TxHistory
    // await TxHistory.create({ ...params, createdAt: new Date() })
    // пока — просто выводим в консоль
    // eslint-disable-next-line no-console
    console.log("[ADMIN ACTION]", {
      ...params,
      adminId: String(params.adminId),
      targetId: String(params.targetId),
      ts: new Date().toISOString(),
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("logAdminAction error:", e);
  }
}
