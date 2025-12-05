// src/tgBot/bot.ts
import "dotenv/config";
import { Bot as GrammyBot, Context, InlineKeyboard, session } from "grammy";
import type { SessionFlavor } from "grammy";
import mongoose, { Types } from "mongoose";
import type { InlineKeyboardMarkup } from "grammy/types";

// Модели
import { User } from "../models/User.js";
import { TxHistory } from "../models/TxHistory.js";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Bot as SenderBotModel } from "../models/Bot.js";

/* ========= ENV (строго строки) ========= */
function must(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}
const BOT_TOKEN = must("BOT_TOKEN");

// username можно передавать как MAIN_BOT_USERNAME или BOT_USERNAME; @ срежем
function readUsername(): string {
  const raw = process.env.MAIN_BOT_USERNAME || process.env.BOT_USERNAME || "";
  if (!raw) throw new Error("MAIN_BOT_USERNAME (или BOT_USERNAME) is required");
  return raw.replace(/^@/, "");
}
const MAIN_BOT_USERNAME = readUsername();

// URL БД можно задать как MONGO_URL или MONGO_URI
const MONGO_URL = process.env.MONGO_URL || process.env.MONGO_URI || "";
if (!MONGO_URL) throw new Error("MONGO_URL (или MONGO_URI) is required");

const CRYPTO_WALLET = must("CRYPTO_WALLET");
const MINIAPP_URL = must("MINIAPP_URL");
const ACCESS_PRICE = process.env.ACCESS_PRICE ?? "10";
const ACCESS_CURRENCY = process.env.ACCESS_CURRENCY ?? "USDT";

/* ========= Session ========= */
type MySession = { lastAction?: "buy_access" | "ref" | "open_app" };
type MyContext = Context & SessionFlavor<MySession>;
const initialSession = (): MySession => ({});

/* ========= Helpers ========= */
const kbMain = (hasAccess: boolean) =>
  new InlineKeyboard()
    .webApp("📲 Открыть приложение", MINIAPP_URL)
    .row()
    .text("👥 Рефералка", "ref")
    .row()
    .text(hasAccess ? "✅ Доступ активен" : "💳 Купить доступ", "buy_access");

function generate12DigitCode(): string {
  const ts = Date.now().toString().slice(-8);
  const rnd = Math.floor(Math.random() * 1e8)
    .toString()
    .padStart(8, "0");
  return (ts + rnd).slice(0, 12);
}

function buildRefMessage(refLink: string) {
  return (
    `🔥 Я нашёл мощный сервис рассылок в Telegram — создаёшь бота, настраиваешь интервал (1ч/2ч/…/24ч) и он сам шлёт сообщения по чатам.\n` +
    `Переходи по моей ссылке: ${refLink}\n` +
    `Бонусы за регистрацию по ссылке и реферальная программа.`
  );
}

async function ensureMongo() {
  if (mongoose.connection.readyState === 0) {
    mongoose.set("strictQuery", true);
    await mongoose.connect(MONGO_URL, { dbName: "tgsender" });
  }
}

/**
 * Тянем аватар юзера из Telegram и сохраняем в user.avatarUrl, если там пусто
 */
async function ensureUserAvatar(user: any, ctx: MyContext) {
  try {
    if (user.avatarUrl && typeof user.avatarUrl === "string") return;

    const telegramUser  = ctx.from;
    if (!telegramUser ) return;

    const photos = await ctx.api.getUserProfilePhotos(telegramUser.id, { limit: 1 });

    // безопасные проверки
    if (
      !photos ||
      typeof photos.total_count !== "number" ||
      photos.total_count === 0 ||
      !Array.isArray(photos.photos) ||
      photos.photos.length === 0 ||
      !Array.isArray(photos.photos[0]) ||
      photos.photos[0].length === 0
    ) {
      return;
    }

    // TS: точно не undefined
    const firstSize = (photos.photos[0][0])!;
    if (!firstSize.file_id) return;

    const file = await ctx.api.getFile(firstSize.file_id);
    if (!file?.file_path) return;

    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

    user.avatarUrl = url;
    await user.save();


    console.log("Saved avatarUrl for user", user.tgId, url);
  } catch (err) {
    console.error("ensureUserAvatar error:", err);
  }
}


/** Аккуратное редактирование: глушим 400 "message is not modified" */
async function safeEdit(
  ctx: MyContext,
  html: string,
  kb?: InlineKeyboard
): Promise<void> {
  try {
    await ctx.editMessageText(html, {
      parse_mode: "HTML",
      // ВАЖНО: грамотно приводим InlineKeyboard -> InlineKeyboardMarkup
      reply_markup: (kb as unknown as InlineKeyboardMarkup) || undefined,
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

/** Безопасный reply с parse_mode и клавой */
function safeReply(ctx: MyContext, html: string, kb?: InlineKeyboard) {
  return ctx.reply(html, {
    parse_mode: "HTML",
    reply_markup: (kb as unknown as InlineKeyboardMarkup) || undefined,
  });
}

/** Создать или переиспользовать pending-платёж на доступ (не плодить дубли) */
async function createOrReusePendingAccess(
  userId: Types.ObjectId,
  amount: number,
  currency: string,
  wallet: string
) {
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  const existing = await TxHistory.findOne({
    user: userId,
    type: "ACCESS_PURCHASE",
    status: "pending",
    createdAt: { $gte: tenMinAgo },
  }).sort({ createdAt: -1 });

  if (existing) return existing;

  const code12 = generate12DigitCode();
  return TxHistory.create({
    user: userId,
    type: "ACCESS_PURCHASE",
    status: "pending",
    amount,
    currency,
    wallet,
    code12,
    meta: { reason: "buy_access" },
  });
}

/* ========= Создаём инстанс бота ========= */
type LaunchableBot = GrammyBot<MyContext> & { launch: () => Promise<void> };
const bot = new GrammyBot<MyContext>(BOT_TOKEN) as unknown as LaunchableBot;

// session
bot.use(session({ initial: initialSession }));

/* ========= Handlers ========= */

// /start (+payload refCode)
bot.command("start", async (ctx) => {
  try {
    await ensureMongo();

    const payload = (ctx.match ?? "").trim(); // реф-код
    const tg = ctx.from!;
    let user = await User.findOne({ tgId: tg.id });

    const baseProfile = {
      username: tg.username ?? "",
      firstName: tg.first_name ?? "",
      lastName: tg.last_name ?? "",
    };

    if (!user) {
      user = new User({
        tgId: tg.id,
        ...baseProfile,
        status: "active",
        hasAccess: false,
      });

      // рефералка — привязываем только если есть валидный инвайтер и ещё не привязан
      if (payload) {
        const inviter = await User.findOne({ refCode: payload });
        if (inviter && inviter.tgId !== tg.id) {
          if (!user.invitedBy) {
            user.invitedBy = inviter._id as Types.ObjectId;

            // прямые
            inviter.referrals.push(user._id as Types.ObjectId);
            inviter.referralLevels.lvl1 += 1;
            await inviter.save();

            // уровни 2–5
            let parent = inviter;
            for (let level = 2; level <= 5; level++) {
              if (!parent.invitedBy) break;
              const up = await User.findById(parent.invitedBy);
              if (!up) break;
              (up.referralLevels as any)[`lvl${level}`] =
                ((up.referralLevels as any)[`lvl${level}`] || 0) + 1;
              await up.save();
              parent = up;
            }
          }
        }
      }
      await user.save();
    } else {
      // мягкий апдейт профиля (строго строки)
      user.username = baseProfile.username || (user.username ?? "");
      user.firstName = baseProfile.firstName || (user.firstName ?? "");
      user.lastName = baseProfile.lastName || (user.lastName ?? "");
      await user.save();

      // если юзер уже создан, но пришёл с payload впервые и ещё не привязан — можно привязать 1 раз
      if (payload && !user.invitedBy) {
        const inviter = await User.findOne({ refCode: payload });
        if (inviter && inviter.tgId !== tg.id) {
          user.invitedBy = inviter._id as Types.ObjectId;
          await user.save();

          inviter.referrals.push(user._id as Types.ObjectId);
          inviter.referralLevels.lvl1 += 1;
          await inviter.save();

          // прокидываем уровни 2–5
          let parent = inviter;
          for (let level = 2; level <= 5; level++) {
            if (!parent.invitedBy) break;
            const up = await User.findById(parent.invitedBy);
            if (!up) break;
            (up.referralLevels as any)[`lvl${level}`] =
              ((up.referralLevels as any)[`lvl${level}`] || 0) + 1;
            await up.save();
            parent = up;
          }
        }
      }
    }

    // ✅ здесь тянем фотку и сохраняем avatarUrl, если его ещё нет
    await ensureUserAvatar(user, ctx);

    const refLink = user.generateRefLink(MAIN_BOT_USERNAME);
    const text =
      `Привет, <b>${tg.first_name || "друг"}</b> 👋\n` +
      `Я — бот рассылок. Создавай своих ботов, настраивай интервал (1ч–24ч) и запускай рассылку.\n\n` +
      `• Ваш доступ: <b>${user.hasAccess ? "АКТИВЕН" : "НЕ ОПЛАЧЕН"}</b>\n` +
      `• Ваша реферальная ссылка: <code>${refLink}</code>\n\n` +
      `Кнопка приложения ниже. Если доступа нет — внутри подскажем, как оплатить.`;

    await safeReply(ctx, text, kbMain(!!user.hasAccess));
  } catch (e) {
    console.error(e);
    await ctx.reply("Упс, что-то пошло не так. Попробуйте ещё раз.");
  }
});

// Рефералка
bot.callbackQuery("ref", async (ctx) => {
  try {
    const user = await User.findOne({ tgId: ctx.from!.id });
    if (!user) return ctx.answerCallbackQuery({ text: "Сначала /start" });

    const refLink = user.generateRefLink(MAIN_BOT_USERNAME);
    const refs = await User.find({ invitedBy: user._id }).select(
      "username firstName tgId"
    );
    const refsList =
      refs.length === 0
        ? "— пока нет"
        : refs
            .slice(0, 20)
            .map((r, i) =>
              `${i + 1}. ${
                r.username ? "@" + r.username : r.firstName || r.tgId
              }`
            )
            .join("\n");

    const text =
      `<b>Реферальная программа</b>\n\n` +
      `Ваша ссылка: <code>${refLink}</code>\n\n` +
      `<b>Готовое сообщение для отправки:</b>\n` +
      `<code>${buildRefMessage(refLink)}</code>\n\n` +
      `<b>Статистика:</b>\n` +
      `• Уровень 1: ${user.referralLevels.lvl1}\n` +
      `• Уровень 2: ${user.referralLevels.lvl2}\n` +
      `• Уровень 3: ${user.referralLevels.lvl3}\n` +
      `• Уровень 4: ${user.referralLevels.lvl4}\n` +
      `• Уровень 5: ${user.referralLevels.lvl5}\n` +
      `• Баланс: <b>${user.referralBalance.toFixed(
        2
      )}</b> ${ACCESS_CURRENCY}\n\n` +
      `<b>Ваши приглашённые (первые 20):</b>\n${refsList}`;

    await safeEdit(ctx, text, kbMain(!!user.hasAccess));
  } catch (e) {
    console.error(e);
    await ctx.answerCallbackQuery({ text: "Ошибка" });
  }
});

// Купить доступ (создаём/переиспользуем pending)
bot.callbackQuery("buy_access", async (ctx) => {
  try {
    const user = await User.findOne({ tgId: ctx.from!.id });
    if (!user) return ctx.answerCallbackQuery({ text: "Сначала /start" });

    const transaction = await createOrReusePendingAccess(
      user._id as Types.ObjectId,
      Number(ACCESS_PRICE),
      ACCESS_CURRENCY,
      CRYPTO_WALLET
    );

    const text =
      `<b>Оплата доступа</b>\n\n` +
      `Сумма: <b>${ACCESS_PRICE} ${ACCESS_CURRENCY}</b>\n` +
      `Кошелёк: <code>${CRYPTO_WALLET}</code>\n` +
      `Ваш 12-значный код: <code>${transaction.code12}</code>\n\n` +
      `⚠️ Обязательно укажите код в комментарии/мемо перевода.\n` +
      `После отправки нажмите «Проверить оплату» — проверка занимает до 10 минут.`;

    const kb = new InlineKeyboard()
      .text("✅ Я оплатил — проверить", `check_access_${transaction.code12}`)
      .row()
      .webApp("📲 Открыть приложение", MINIAPP_URL)
      .row()
      .text("◀️ Назад", "ref");

    await safeEdit(ctx, text, kb);
  } catch (e) {
    console.error(e);
    await ctx.answerCallbackQuery({ text: "Ошибка" });
  }
});

// Проверка оплаты (заглушка)
bot.callbackQuery(/^check_access_(\d{12})$/, async (ctx) => {
  const code = ctx.match![1];
  try {
    const user = await User.findOne({ tgId: ctx.from!.id });
    if (!user) return ctx.answerCallbackQuery({ text: "Сначала /start" });

    const tx = await TxHistory.findOne({
      user: user._id,
      code12: code,
      type: "ACCESS_PURCHASE",
    }).sort({ createdAt: -1 });

    if (!tx) {
      await ctx.answerCallbackQuery({
        text: "Платёж не найден",
        show_alert: true,
      });
      return;
    }

    if (tx.status === "confirmed") {
      if (!user.hasAccess) {
        user.hasAccess = true;
        user.accessGrantedAt = new Date();
        await user.save();
      }
      await ctx.answerCallbackQuery({ text: "Оплата подтверждена!" });
      await safeEdit(
        ctx,
        `🎉 Доступ активирован!\nТеперь можете пользоваться приложением.`,
        kbMain(true)
      );
    } else if (tx.status === "pending") {
      await ctx.answerCallbackQuery({
        text: "Оплата ещё в обработке…",
        show_alert: true,
      });
    } else if (tx.status === "failed" || tx.status === "expired") {
      await ctx.answerCallbackQuery({
        text: "Оплата не прошла",
        show_alert: true,
      });
    } else {
      await ctx.answerCallbackQuery({
        text: "Статус неизвестен",
        show_alert: true,
      });
    }
  } catch (e) {
    console.error(e);
    await ctx.answerCallbackQuery({ text: "Ошибка" });
  }
});

// Фолбэк
bot.on("message", async (ctx) => {
  const user = await User.findOne({ tgId: ctx.from!.id });
  const hasAccess = !!user?.hasAccess;
  await safeReply(ctx, "Главное меню:", kbMain(hasAccess));
});

/* ========= Добавляем совместимость с index.ts (launch/stop) ========= */
// После строки bot.launch = async () => {
bot.launch = async () => {
  await ensureMongo();
  
  // ✅ Настраиваем Menu Button для WebApp
  try {
    await (bot as GrammyBot<MyContext>).api.setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: "Открыть приложение",
        web_app: { url: MINIAPP_URL }
      }
    });
    console.log("✅ Menu button configured");
  } catch (err) {
    console.error("Failed to set menu button:", err);
  }
  
  await (bot as GrammyBot<MyContext>).start();
};

/* ========= Дефолтный экспорт ========= */
export default bot;
