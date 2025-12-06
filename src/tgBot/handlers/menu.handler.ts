// src/tgBot/handlers/menu.handler.ts
import { User } from "../../models/User.js";
import { getMainKeyboard } from "../utils/keyboard.js";
import { safeReply } from "../utils/helpers.js";

/**
 * Обработчик всех остальных сообщений (fallback в главное меню)
 */
export async function handleMenu(ctx: any) {
  try {
    const user = await User.findOne({ tgId: ctx.from!.id });
    const hasAccess = !!user?.hasAccess;

    await safeReply(ctx, "Главное меню:", getMainKeyboard(hasAccess));
  } catch (e) {
    console.error("❌ handleMenu error:", e);
    await ctx.reply("Главное меню:", { 
      reply_markup: getMainKeyboard(false) 
    });
  }
}