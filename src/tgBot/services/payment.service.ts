// src/tgBot/services/payment.service.ts
import { Types } from "mongoose";
import { TxHistory } from "../../models/TxHistory.js";
import { generate12DigitCode } from "../utils/helpers.js";

const CRYPTO_WALLET = process.env.CRYPTO_WALLET || "";
const ACCESS_PRICE = process.env.ACCESS_PRICE || "10";
const ACCESS_CURRENCY = process.env.ACCESS_CURRENCY || "USDT";

/**
 * Создаёт или переиспользует pending-платёж на доступ (не плодит дубли)
 */
export async function createOrReusePendingAccess(userId: Types.ObjectId) {
  // Ищем свежий pending за последние 10 минут
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  
  const existing = await TxHistory.findOne({
    user: userId,
    type: "ACCESS_PURCHASE",
    status: "pending",
    createdAt: { $gte: tenMinAgo },
  }).sort({ createdAt: -1 });

  if (existing) {
    return existing;
  }

  // Создаём новый
  const code12 = generate12DigitCode();
  
  return TxHistory.create({
    user: userId,
    type: "ACCESS_PURCHASE",
    status: "pending",
    amount: Number(ACCESS_PRICE),
    currency: ACCESS_CURRENCY,
    wallet: CRYPTO_WALLET,
    code12,
    meta: { reason: "buy_access" },
  });
}

/**
 * Проверяет статус платежа и активирует доступ если оплачено
 */
export async function checkPaymentStatus(code12: string, userId: Types.ObjectId) {
  const tx = await TxHistory.findOne({
    user: userId,
    code12,
    type: "ACCESS_PURCHASE",
  }).sort({ createdAt: -1 });

  if (!tx) {
    return { status: "not_found", message: "Платёж не найден" };
  }

  if (tx.status === "confirmed") {
    return { status: "confirmed", message: "Оплата подтверждена!" };
  }

  if (tx.status === "pending") {
    return { status: "pending", message: "Оплата ещё в обработке…" };
  }

  if (tx.status === "failed" || tx.status === "expired") {
    return { status: "failed", message: "Оплата не прошла" };
  }

  return { status: "unknown", message: "Статус неизвестен" };
}