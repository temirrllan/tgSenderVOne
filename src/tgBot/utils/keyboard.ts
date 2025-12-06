// src/tgBot/utils/keyboard.ts
import { InlineKeyboard } from "grammy";

const MINIAPP_URL = process.env.MINIAPP_URL || "";

/**
 * Главная клавиатура с кнопкой открытия приложения
 */
export function getMainKeyboard(hasAccess: boolean): InlineKeyboard {
  return new InlineKeyboard()
    .webApp("📲 Открыть приложение", MINIAPP_URL)
    .row()
    .text("👥 Рефералка", "ref")
    .row()
    .text(hasAccess ? "✅ Доступ активен" : "💳 Купить доступ", "buy_access");
}

/**
 * Клавиатура для экрана оплаты
 */
export function getPaymentKeyboard(code12: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Я оплатил — проверить", `check_access_${code12}`)
    .row()
    .webApp("📲 Открыть приложение", MINIAPP_URL)
    .row()
    .text("◀️ Назад", "ref");
}