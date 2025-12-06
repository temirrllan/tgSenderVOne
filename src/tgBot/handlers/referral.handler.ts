// src/tgBot/handlers/referral.handler.ts
import { User } from "../../models/User.js";
import { getReferralStats } from "../services/referral.service.js";
import { getReferralStatsMessage } from "../utils/messages.js";
import { getMainKeyboard } from "../utils/keyboard.js";
import { safeEdit } from "../utils/helpers.js";

const MAIN_BOT_USERNAME = process.env.MAIN_BOT_USERNAME || "";

/**
 * Обработчик кнопки "Рефералка"
 */
export async function handleReferral(ctx: any) {
  try {
    const user = await User.findOne({ tgId: ctx.from!.id });
    
    if (!user) {
      return ctx.answerCallbackQuery({ text: "Сначала /start" });
    }

    // Получаем статистику
    const { refsList } = await getReferralStats(user._id);
    const refLink = user.generateRefLink(MAIN_BOT_USERNAME);

    // Формируем сообщение
    const message = getReferralStatsMessage(refLink, user, refsList);

    // Отправляем
    await safeEdit(ctx, message, getMainKeyboard(!!user.hasAccess));
  } catch (e) {
    console.error("❌ handleReferral error:", e);
    await ctx.answerCallbackQuery({ text: "Ошибка" });
  }
}