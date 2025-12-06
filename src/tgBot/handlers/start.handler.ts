// src/tgBot/handlers/start.handler.ts
import { findOrCreateUser } from "../services/user.service.js";
import { ensureUserAvatar } from "../services/avatar.service.js";
import { getWelcomeMessage } from "../utils/messages.js";
import { getMainKeyboard } from "../utils/keyboard.js";
import { safeReply } from "../utils/helpers.js";

const MAIN_BOT_USERNAME = process.env.MAIN_BOT_USERNAME || "";

/**
 * Обработчик команды /start
 */
export async function handleStart(ctx: any) {
  try {
    const payload = (ctx.match ?? "").trim(); // реф-код
    const tg = ctx.from!;

    // Создаём/обновляем пользователя
    const user = await findOrCreateUser(tg, payload);

    // Загружаем аватар если его нет
    await ensureUserAvatar(user, ctx);

    // Формируем реферальную ссылку
    const refLink = user.generateRefLink(MAIN_BOT_USERNAME);

    // Отправляем приветственное сообщение
    const message = getWelcomeMessage(
      tg.first_name,
      !!user.hasAccess,
      refLink
    );

    await safeReply(ctx, message, getMainKeyboard(!!user.hasAccess));
  } catch (e) {
    console.error("❌ handleStart error:", e);
    await ctx.reply("Упс, что-то пошло не так. Попробуйте ещё раз.");
  }
}