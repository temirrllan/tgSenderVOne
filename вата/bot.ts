// src/telegraf/bot.ts
import "dotenv/config";
import { Telegraf, session, Markup } from "telegraf";
import type { Context } from "telegraf";
import { User } from "../common/mongo/Models/User.js"; // проверь путь, но по структуре должно быть верно

const BOT_TOKEN = process.env.BOT_TOKEN || "";
let BOT_USERNAME = (process.env.BOT_USERNAME || "").replace(/^@/, ""); // без @
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not set in env");
}

const bot = new Telegraf(BOT_TOKEN);

// Сессии
bot.use(
  session({
    defaultSession: () => ({ sending: false, images: [] }),
  }) as any
);

// Бот отвечает только в приватных чатах
bot.use(async (ctx: Context, next: any) => {
  const t = (ctx as any).chat?.type;
  if (t && t !== "private") {
    return;
  }
  return next();
});

// Вспомог: отображаемое имя
function displayName(from: any) {
  if (!from) return "";
  return [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || `#${from.id}`;
}

// Текст описания
const MINI_APP_DESCRIPTION = `Добро пожаловать в наш мини-апп — удобную панель для покупки и управления ботами рассылки в Telegram с привязанными реальными номерами.

Почему это полезно:
• Готовые боты — покупаете пакет и сразу начинаете работать (без долгой настройки).
• Надёжные номера — интеграция с легальными провайдерами, учет и распределение номеров по пакетам.
• Безопасность и соответствие — обязательный opt-in, лимиты отправки и модерация кампаний, чтобы избежать блокировок и жалоб.
• Плавная автоматизация — планирование рассылок, очереди отправки и трассировка результата (доставлено/отказ/жалоба).
• Статистика и отчёты — подробная аналитика доставляемости, открытий и откликов.
• Контроль затрат — прозрачная тарификация, учёт баланса и история транзакций.

Как это работает (кратко):
1) Регистрируетесь и привязываете номер (через кнопку ниже).
2) Покупаете пакет с нужным количеством номеров/лимитов.
3) Создаёте кампанию: загружаете список получателей (только opt-in), пишите текст, ставите расписание.
4) Система ставит задачи в очередь и аккуратно отправляет, соблюдая лимиты и правила.
5) Получаете отчёты и в любой момент можете приостановить кампанию.
`;

/* ----------------- Referral helpers ----------------- */

/**
 * Пытаемся найти реферера по payload:
 * - numeric tgId
 * - string tgId
 * - tgUsername
 */
async function findRefUserByPayload(payload: string | undefined) {
  if (!payload) return null;

  // numeric tgId
  if (/^\d+$/.test(payload)) {
    const numeric = Number(payload);
    const foundNum = await User.findOne({ tgId: numeric }).exec();
    if (foundNum) return foundNum;
  }

  // try exact tgId as string
  const foundById = await User.findOne({ tgId: payload }).exec();
  if (foundById) return foundById;

  // try username
  const foundByUsername = await User.findOne({ tgUsername: payload }).exec();
  if (foundByUsername) return foundByUsername;

  return null;
}

/**
 * Проверка: является ли ancestorId предком у candidateId (в цепочке ref -> ref -> ...)
 * Возвращает true, если ancestorId встречается в цепочке вверх от candidateId.
 * Это предотвращает циклы рефералов.
 */
async function isAncestor(ancestorId: string | number, candidateId: string | number) {
  try {
    let currentId: any = candidateId;
    const maxDepth = 50;
    let depth = 0;
    while (currentId && depth < maxDepth) {
      const doc = await User.findOne({ tgId: currentId }).select("ref").lean().exec();
      if (!doc || !doc.ref) break;
      if (String(doc.ref) === String(ancestorId)) return true;
      currentId = doc.ref;
      depth++;
    }
  } catch (e) {
    console.warn("isAncestor error", e);
  }
  return false;
}

/**
 * Простая логика начисления реферальных бонусов по уровням
 * CHANGED: сохр. в refBalance и уведомляет каждого уровня
 */
async function referralLogic(newUser: any, levels = 3, amount = 500) {
  try {
    let currentRefTgId: any = newUser.ref;
    for (let lvl = 1; lvl <= levels && currentRefTgId; lvl++) {
      const ref = await User.findOne({ tgId: currentRefTgId }).exec();
      if (!ref) break;
      const reward = Math.max(1, Math.floor(amount / (lvl + 1)));
      try {
        await User.updateOne({ _id: ref._id }, { $inc: { refBalance: reward } }).exec();
        try {
          await bot.telegram.sendMessage(
            ref.tgId,
            `Вы получили реферальный бонус ${reward} за приглашение (уровень ${lvl}). Спасибо!`
          );
        } catch (notifyErr) {
          console.warn("Couldn't notify ref user", ref.tgId, notifyErr);
        }
      } catch (e) {
        console.warn("Error giving referral reward to", ref.tgId, e);
      }
      currentRefTgId = ref.ref;
    }
  } catch (e) {
    console.warn("referralLogic error", e);
  }
}

/* ----------------- Save / update user ----------------- */

/**
 * CHANGED: теперь не затираем телефон если не передан; читаем tgImage если есть;
 * пытаемся получить photo link если нет tgImage.
 */
async function saveOrUpdateUserFromCtx(ctx: Context, phoneIfAny?: string | null) {
  const from = (ctx as any).from!;
  const chatId = (ctx as any).chat?.id ?? from.id;
  const tgId = from.id;

  let existing: any = null;
  try {
    existing = await User.findOne({ tgId }).select("tgImage phone ref").lean().exec();
  } catch (e) {
    console.warn("Warning: couldn't read existing user:", e);
  }

  const setFields: any = {
    chatId,
    tgName: displayName(from),
    tgUsername: from.username,
    lastSeenAt: new Date(),
    updatedAt: new Date(),
  };

  if (typeof phoneIfAny !== "undefined" && phoneIfAny !== null) {
    setFields.phone = phoneIfAny;
  }

  if (!existing?.tgImage) {
    try {
      const photos: any = await bot.telegram.getUserProfilePhotos(tgId, 0, 1);
      if (photos && photos.total_count && Array.isArray(photos.photos) && photos.photos.length > 0) {
        const sizes = photos.photos[0];
        if (Array.isArray(sizes) && sizes.length > 0) {
          const largest = sizes[sizes.length - 1];
          if (largest) {
            try {
              const link = await bot.telegram.getFileLink(largest.file_id);
              setFields.tgImage = String(link);
            } catch {
              setFields.tgImage = largest.file_id;
            }
          }
        }
      }
    } catch (err) {
      console.warn("Couldn't fetch profile photo for user", tgId, err);
    }
  } else {
    setFields.tgImage = existing.tgImage;
  }

  const query = { tgId };
  const update: any = { $set: setFields };
  const options = { upsert: true, new: true, setDefaultsOnInsert: true };

  try {
    const doc = await User.findOneAndUpdate(query, update, options).exec();
    return doc;
  } catch (err: any) {
    if (err && (err.code === 11000 || err.codeName === "DuplicateKey")) {
      return User.findOne(query).exec();
    }
    throw err;
  }
}

/* ----------------- Deeplink helpers ----------------- */

/**
 * CHANGED: если BOT_USERNAME нет в .env — пробуем getMe() и кешируем
 */
async function ensureBotUsername() {
  if (BOT_USERNAME) return BOT_USERNAME;
  try {
    const me = await bot.telegram.getMe();
    if (me && me.username) {
      BOT_USERNAME = me.username.replace(/^@/, "");
      console.log("Resolved bot username from Telegram:", BOT_USERNAME);
      return BOT_USERNAME;
    }
  } catch (e) {
    console.warn("Could not fetch bot username via getMe()", e);
  }
  return null;
}

async function buildDeeplinkForTgId(tgId: number | string) {
  const username = await ensureBotUsername();
  if (!username) return null;
  return `https://t.me/${username}?start=${encodeURIComponent(String(tgId))}`;
}

/* ----------------- /start handler ----------------- */

/**
 * CHANGED:
 * - поддержка payload (ctx.startPayload или /start <payload>)
 * - проверка self-referral
 * - предотвращение циклов (isAncestor)
 * - аккуратное добавление реферала и начисление бонусов
 */
bot.start(async (ctx: Context & { startPayload?: string; message?: any }) => {
  const from = (ctx as any).from!;
  // payload может быть в ctx.startPayload или в тексте /start <payload>
  const payload =
    (ctx as any).startPayload ||
    (ctx.message?.text ? String(ctx.message.text).split(" ")[1] : undefined);

  try {
    const existingUser = await User.findOne({ tgId: from.id }).exec();

    if (!existingUser) {
      const refCandidate = await findRefUserByPayload(payload);
      let validRefUser: any = null;

      if (refCandidate) {
        if (String(refCandidate.tgId) === String(from.id)) {
          await (ctx as any).reply("Реферальная ссылка недействительна: вы не можете указывать себя как реферера.");
        } else {
          // проверяем что newUser (from.id) не является предком refCandidate (иначе цикл)
          const createsCycle = await isAncestor(from.id, refCandidate.tgId);
          if (createsCycle) {
            await (ctx as any).reply("Реферальная ссылка недействительна: это создаёт циклическую привязку рефералов.");
          } else {
            validRefUser = refCandidate;
          }
        }
      }

      const newUserObj: any = {
        tgId: from.id,
        tgUsername: from.username ?? "",
        tgName: displayName(from),
        ref: validRefUser ? String(validRefUser.tgId) : "",
        createdAt: new Date(),
      };

      const newUser = new User(newUserObj);
      await newUser.save();

      if (validRefUser) {
        try {
          await User.updateOne({ _id: validRefUser._id }, { $addToSet: { referrals: newUser.tgId } }).exec();
          // начисляем бонус напрямую новому пользователю? В твоём варианте — вы делали update balance для newUser
          // Я оставил начисление баланса новичку (как у тебя было): +500
          await User.updateOne({ _id: newUser._id }, { $inc: { balance: 500 } }).exec();

          try {
            await bot.telegram.sendMessage(
              validRefUser.tgId,
              `Пользователь ${displayName(from)} (tgId: ${from.id}) зарегистрировался по вашей реферальной ссылке. Вам начислен бонус.`
            );
          } catch (notifyErr) {
            console.warn("Couldn't notify refUser", validRefUser.tgId, notifyErr);
          }

          // распределяем по уровнем, если нужно
          await referralLogic(newUser, 3, 500);
        } catch (e) {
          console.warn("Error processing ref rewards", e);
        }
      }

      await (ctx as any).reply(
        `Добро пожаловать, ${displayName(from)}! ${validRefUser ? `Вы пришли по реферальной ссылке от ${validRefUser.tgName || validRefUser.tgUsername}` : ""}`
      );
    } else {
      await (ctx as any).reply(`С возвращением, ${displayName(from)}!`);
    }

    await saveOrUpdateUserFromCtx(ctx);

    const userDoc = await User.findOne({ tgId: from.id }).select("phone").lean().exec();
    if (!userDoc || !userDoc.phone) {
      await (ctx as any).reply(
        `Добро пожаловать, ${displayName(from)}!\n\n${MINI_APP_DESCRIPTION}\n\nЧтобы продолжить и активировать возможности мини-аппа, поделитесь, пожалуйста, вашим телефоном:`,
        Markup.keyboard([[Markup.button.contactRequest("Поделиться телефоном")]]).oneTime().resize()
      );
      return;
    }

    await (ctx as any).reply(
      `Добро пожаловать, ${displayName(from)}!\n\n${MINI_APP_DESCRIPTION}\n\nЧтобы начать, выберите действие:`,
      Markup.keyboard([["Мини-апп", "Реферальная ссылка", "Моя рефка"]]).resize()
    );
  } catch (error) {
    console.error("Error in /start handler:", error);
    await (ctx as any).reply("Произошла ошибка при обработке /start. Попробуйте позже.");
  }
});

/* ----------------- contact handler ----------------- */

bot.on("contact", async (ctx: Context) => {
  const contact = (ctx as any).message?.contact;
  const from = (ctx as any).from!;
  if (!contact) return;

  if (typeof contact.user_id !== "undefined" && contact.user_id !== from.id) {
    console.warn("Получен контакт не от владельца аккаунта:", contact);
    await (ctx as any).reply("Пожалуйста, поделитесь своим номером (не чужим).");
    return;
  }

  try {
    await saveOrUpdateUserFromCtx(ctx, contact.phone_number);
    await (ctx as any).reply("Спасибо! Номер сохранён.");
    await (ctx as any).reply("Выберите действие:", Markup.keyboard([["Создать кампанию", "Баланс", "Реферальная ссылка"]]).resize());
  } catch (err) {
    console.error("Ошибка при сохранении контакта:", err);
    await (ctx as any).reply("Не удалось сохранить контакт. Попробуйте позже.");
  }
});

/* ----------------- Text handlers ----------------- */

bot.hears(/^(Мини-апп|мини-апп|Mini|app)$/i, async (ctx: Context) => {
  await (ctx as any).reply(MINI_APP_DESCRIPTION);
});

/**
 * Реферальная ссылка — возвращаем deeplink текущего пользователя
 * CHANGED: uses buildDeeplinkForTgId which can call getMe() if BOT_USERNAME not set
 */
bot.hears(/^(Реферальная ссылка|Реферал|Рефералька|referral)$/i, async (ctx: Context) => {
  const from = (ctx as any).from!;
  try {
    await saveOrUpdateUserFromCtx(ctx);
    const user = await User.findOne({ tgId: from.id }).lean().exec();
    if (!user) return await (ctx as any).reply("Не удалось получить ваш профиль. Попробуйте ещё раз.");

    const deeplink = await buildDeeplinkForTgId(user.tgId);
    if (!deeplink) {
      return await (ctx as any).reply("DEEPLINK не настроен (BOT_USERNAME не задан и получить username через API не получилось). Обратитесь к администратору или добавьте BOT_USERNAME в .env.");
    }

    await (ctx as any).reply(`Ваша реферальная ссылка:\n\n${deeplink}\n\nОтправьте её друзьям — когда они зарегистрируются, вы получите бонусы.`);
  } catch (e) {
    console.error("Error in referral command:", e);
    await (ctx as any).reply("Ошибка при формировании реферальной ссылки.");
  }
});

/**
 * /myref — показывает кто вас пригласил, сколько у вас рефералов и refBalance
 */
bot.hears(/^(Моя рефка|Мои рефералы|\/myref)$/i, async (ctx: Context) => {
  const from = (ctx as any).from!;
  try {
    await saveOrUpdateUserFromCtx(ctx);
    const user = await User.findOne({ tgId: from.id }).lean().exec();
    if (!user) return await (ctx as any).reply("Не удалось загрузить профиль.");

    const refCount = await User.countDocuments({ ref: String(user.tgId) }).exec();
    const refList = await User.find({ ref: String(user.tgId) }).select("tgId tgName tgUsername createdAt").limit(20).lean().exec();

    const refInfo = user.ref ? `Пригласил: ${user.ref}` : "Вас никто не приглашал";
    const text = [
      `${displayName(user as any)} (tgId: ${user.tgId})`,
      refInfo,
      `Рефералов: ${refCount}`,
      `Заработано (refBalance): ${user.refBalance ?? 0}`,
      "",
      refList.length ? `Последние рефералы:\n${refList.map((r: any) => `• ${r.tgName || r.tgUsername || r.tgId} (tgId: ${r.tgId})`).join("\n")}` : "Пока нет видимых рефералов"
    ].join("\n");

    await (ctx as any).reply(text);
  } catch (e) {
    console.error("Error in /myref handler:", e);
    await (ctx as any).reply("Ошибка при получении информации о рефералах.");
  }
});

export default bot;
