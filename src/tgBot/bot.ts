// src/telegraf/bot.ts
import "dotenv/config";
import { Telegraf, session } from "telegraf";

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const bot = new Telegraf(BOT_TOKEN);

// 1) Сессии — ставим самыми первыми
bot.use(
  session({
    defaultSession: () => ({ sending: false, images: [] }),
  }) as any
);

// 3) Глобальный фильтр: в группах бот молчит
bot.use(async (ctx, next) => {
  const t = ctx.chat?.type;
  // Разрешаем только приватные чаты; в группах всё игнорируется
  if (t && t !== "private") {
    return;
  }
  return next();
});

// 4) /start → главное меню (только в личке)
bot.start(async (ctx) => {
  // SAVE USER TO DB

  // REFERRAL LOGIC
  const first = ctx.from?.first_name ?? "друг";
  await ctx.reply(`Добро пожаловать, ${first}!`);
  // await sendMainMenu(ctx);
});

export default bot;
