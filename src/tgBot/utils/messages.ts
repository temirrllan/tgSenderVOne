    // src/tgBot/utils/messages.ts

/**
 * Приветственное сообщение /start
 */
export function getWelcomeMessage(
  firstName: string,
  hasAccess: boolean,
  refLink: string
): string {
  return (
    `Привет, <b>${firstName || "друг"}</b> 👋\n` +
    `Я — бот рассылок. Создавай своих ботов, настраивай интервал (1ч–24ч) и запускай рассылку.\n\n` +
    `• Ваш доступ: <b>${hasAccess ? "АКТИВЕН" : "НЕ ОПЛАЧЕН"}</b>\n` +
    `• Ваша реферальная ссылка: <code>${refLink}</code>\n\n` +
    `Кнопка приложения ниже. Если доступа нет — внутри подскажем, как оплатить.`
  );
}

/**
 * Сообщение о реферальной программе
 */
export function getReferralMessage(refLink: string): string {
  return (
    `🔥 Я нашёл мощный сервис рассылок в Telegram — создаёшь бота, настраиваешь интервал (1ч/2ч/…/24ч) и он сам шлёт сообщения по чатам.\n` +
    `Переходи по моей ссылке: ${refLink}\n` +
    `Бонусы за регистрацию по ссылке и реферальная программа.`
  );
}

/**
 * Статистика рефералов
 */
export function getReferralStatsMessage(
  refLink: string,
  user: any,
  refsList: string
): string {
  const ACCESS_CURRENCY = process.env.ACCESS_CURRENCY || "USDT";
  
  return (
    `<b>Реферальная программа</b>\n\n` +
    `Ваша ссылка: <code>${refLink}</code>\n\n` +
    `<b>Готовое сообщение для отправки:</b>\n` +
    `<code>${getReferralMessage(refLink)}</code>\n\n` +
    `<b>Статистика:</b>\n` +
    `• Уровень 1: ${user.referralLevels.lvl1}\n` +
    `• Уровень 2: ${user.referralLevels.lvl2}\n` +
    `• Уровень 3: ${user.referralLevels.lvl3}\n` +
    `• Уровень 4: ${user.referralLevels.lvl4}\n` +
    `• Уровень 5: ${user.referralLevels.lvl5}\n` +
    `• Баланс: <b>${user.referralBalance.toFixed(2)}</b> ${ACCESS_CURRENCY}\n\n` +
    `<b>Ваши приглашённые (первые 20):</b>\n${refsList}`
  );
}

/**
 * Сообщение о покупке доступа
 */
export function getPaymentMessage(code12: string): string {
  const ACCESS_PRICE = process.env.ACCESS_PRICE || "10";
  const ACCESS_CURRENCY = process.env.ACCESS_CURRENCY || "USDT";
  const CRYPTO_WALLET = process.env.CRYPTO_WALLET || "";
  
  return (
    `<b>Оплата доступа</b>\n\n` +
    `Сумма: <b>${ACCESS_PRICE} ${ACCESS_CURRENCY}</b>\n` +
    `Кошелёк: <code>${CRYPTO_WALLET}</code>\n` +
    `Ваш 12-значный код: <code>${code12}</code>\n\n` +
    `⚠️ Обязательно укажите код в комментарии/мемо перевода.\n` +
    `После отправки нажмите «Проверить оплату» — проверка занимает до 10 минут.`
  );
}