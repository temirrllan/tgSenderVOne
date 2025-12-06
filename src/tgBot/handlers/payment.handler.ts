// src/tgBot/handlers/payment.handler.ts
import { Types } from "mongoose";
import { User } from "../../models/User.js";
import { 
  createOrReusePendingAccess, 
  checkPaymentStatus 
} from "../services/payment.service.js";
import { getPaymentMessage } from "../utils/messages.js";
import { getPaymentKeyboard, getMainKeyboard } from "../utils/keyboard.js";
import { safeEdit } from "../utils/helpers.js";

/**
 * Обработчик кнопки "Купить доступ"
 */
export async function handleBuyAccess(ctx: any) {
  try {
    const user = await User.findOne({ tgId: ctx.from!.id });
    
    if (!user) {
      return ctx.answerCallbackQuery({ text: "Сначала /start" });
    }

    // Создаём или переиспользуем pending-платёж
    const transaction = await createOrReusePendingAccess(
      user._id as Types.ObjectId
    );

    // Формируем сообщение
    const message = getPaymentMessage(transaction.code12);

    // Отправляем
    await safeEdit(
      ctx, 
      message, 
      getPaymentKeyboard(transaction.code12)
    );
  } catch (e) {
    console.error("❌ handleBuyAccess error:", e);
    await ctx.answerCallbackQuery({ text: "Ошибка" });
  }
}

/**
 * Обработчик кнопки "Я оплатил — проверить"
 */
export async function handleCheckPayment(ctx: any) {
  const code = ctx.match![1]; // из регулярки /^check_access_(\d{12})$/
  
  try {
    const user = await User.findOne({ tgId: ctx.from!.id });
    
    if (!user) {
      return ctx.answerCallbackQuery({ text: "Сначала /start" });
    }

    // Проверяем статус платежа
    const result = await checkPaymentStatus(
      code, 
      user._id as Types.ObjectId
    );

    if (result.status === "confirmed") {
      // Активируем доступ если ещё не активирован
      if (!user.hasAccess) {
        user.hasAccess = true;
        user.accessGrantedAt = new Date();
        await user.save();
      }

      await ctx.answerCallbackQuery({ text: "Оплата подтверждена!" });
      
      await safeEdit(
        ctx,
        `🎉 Доступ активирован!\nТеперь можете пользоваться приложением.`,
        getMainKeyboard(true)
      );
    } else if (result.status === "pending") {
      await ctx.answerCallbackQuery({
        text: result.message,
        show_alert: true,
      });
    } else {
      await ctx.answerCallbackQuery({
        text: result.message,
        show_alert: true,
      });
    }
  } catch (e) {
    console.error("❌ handleCheckPayment error:", e);
    await ctx.answerCallbackQuery({ text: "Ошибка" });
  }
}