// src/tgBot/utils/helpers.ts

/**
 * Генерация 12-значного кода для платежей
 */
export function generate12DigitCode(): string {
  const ts = Date.now().toString().slice(-8);
  const rnd = Math.floor(Math.random() * 1e8)
    .toString()
    .padStart(8, "0");
  return (ts + rnd).slice(0, 12);
}

/**
 * Безопасное редактирование сообщения (игнорирует "message is not modified")
 */
export async function safeEdit(
  ctx: any,
  html: string,
  kb?: any
): Promise<void> {
  try {
    await ctx.editMessageText(html, {
      parse_mode: "HTML",
      reply_markup: kb || undefined,
    });
  } catch (err: any) {
    const msg = String(err?.description || err?.message || "");
    if (!msg.includes("message is not modified")) {
      console.error("editMessageText error:", err);
    }
  } finally {
    await ctx.answerCallbackQuery().catch(() => {});
  }
}

/**
 * Безопасный ответ с HTML и клавиатурой
 */
export function safeReply(ctx: any, html: string, kb?: any) {
  return ctx.reply(html, {
    parse_mode: "HTML",
    reply_markup: kb || undefined,
  });
}