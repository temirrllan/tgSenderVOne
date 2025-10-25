// src/tgBot/bot.ts
import "dotenv/config";
import { Bot as GrammyBot, Context, InlineKeyboard, session } from "grammy";
import type { SessionFlavor } from "grammy";
import mongoose, { Types } from "mongoose";

// Модели
import { User } from "../common/mongo/Models/User.js";
import { TxHistory } from "../common/mongo/Models/TxHistory.js";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Bot as SenderBotModel } from "../common/mongo/Models/Bot.js";

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

const CRYPTO_WALLET   = must("CRYPTO_WALLET");
const MINIAPP_URL     = must("MINIAPP_URL");
const ACCESS_PRICE    = process.env.ACCESS_PRICE ?? "10";
const ACCESS_CURRENCY = process.env.ACCESS_CURRENCY ?? "USDT";

/* ========= Session ========= */
type MySession = { lastAction?: "buy_access" | "ref" | "open_app" };
type MyContext = Context & SessionFlavor<MySession>;
const initialSession = (): MySession => ({});

/* ========= Helpers ========= */
const kbMain = (_hasAccess: boolean) =>
  new InlineKeyboard()
    .url("📲 Открыть приложение", MINIAPP_URL)
    .row()
    .text("👥 Рефералка", "ref")
    .row()
    .text("💳 Купить доступ", "buy_access");

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
    await mongoose.connect(MONGO_URL, { dbName: "tgsender" });
  }
}

/* ========= Создаём инстанс бота ========= */
type LaunchableBot = GrammyBot<MyContext> & {
  launch: () => Promise<void>;
};

const bot = new GrammyBot<MyContext>(BOT_TOKEN) as unknown as LaunchableBot;

// session
bot.use(session({ initial: initialSession }));

/* ========= Handlers ========= */

// /start (+payload refCode)
bot.command("start", async (ctx) => {
  try {
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

      // рефералка
      if (payload) {
        const inviter = await User.findOne({ refCode: payload });
        if (inviter && inviter.tgId !== tg.id) {
          user.invitedBy = inviter._id as unknown as Types.ObjectId;

          // прямые
          inviter.referrals.push(user._id as unknown as Types.ObjectId);
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
      await user.save();
    } else {
      // апдейт профиля (строго строками — без union типов)
      user.username =
        baseProfile.username && baseProfile.username.length > 0
          ? baseProfile.username
          : (user.username ?? "");
      user.firstName =
        baseProfile.firstName && baseProfile.firstName.length > 0
          ? baseProfile.firstName
          : (user.firstName ?? "");
      user.lastName =
        baseProfile.lastName && baseProfile.lastName.length > 0
          ? baseProfile.lastName
          : (user.lastName ?? "");
      await user.save();
    }

    const refLink = user.generateRefLink(MAIN_BOT_USERNAME);
    const text =
      `Привет, <b>${tg.first_name || "друг"}</b> 👋\n` +
      `Я — бот рассылок. Создавай своих ботов, настраивай интервал (1ч–24ч) и запускай рассылку.\n\n` +
      `• Ваш доступ: <b>${user.hasAccess ? "АКТИВЕН" : "НЕ ОПЛАЧЕН"}</b>\n` +
      `• Ваша реферальная ссылка: <code>${refLink}</code>\n\n` +
      `Кнопка приложения ниже. Если доступа нет — внутри подскажем, как оплатить.`;

    await ctx.reply(text, { reply_markup: kbMain(!!user.hasAccess), parse_mode: "HTML" });
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
    const refs = await User.find({ invitedBy: user._id }).select("username firstName tgId");
    const refsList =
      refs.length === 0
        ? "— пока нет"
        : refs
            .slice(0, 20)
            .map((r, i) => `${i + 1}. ${r.username ? "@" + r.username : r.firstName || r.tgId}`)
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
      `• Баланс: <b>${user.referralBalance.toFixed(2)}</b> ${ACCESS_CURRENCY}\n\n` +
      `<b>Ваши приглашённые (первые 20):</b>\n${refsList}`;

    await ctx.editMessageText(text, { reply_markup: kbMain(user.hasAccess), parse_mode: "HTML" });
    await ctx.answerCallbackQuery();
  } catch (e) {
    console.error(e);
    await ctx.answerCallbackQuery({ text: "Ошибка" });
  }
});

// Купить доступ
bot.callbackQuery("buy_access", async (ctx) => {
  try {
    const user = await User.findOne({ tgId: ctx.from!.id });
    if (!user) return ctx.answerCallbackQuery({ text: "Сначала /start" });

    const code12 = generate12DigitCode();

    await TxHistory.create({
      user: user._id as unknown as Types.ObjectId,
      type: "ACCESS_PURCHASE",
      status: "pending",
      amount: Number(ACCESS_PRICE),
      currency: ACCESS_CURRENCY,
      wallet: CRYPTO_WALLET,
      code12,
      meta: { reason: "buy_access" },
    });

    const text =
      `<b>Оплата доступа</b>\n\n` +
      `Сумма: <b>${ACCESS_PRICE} ${ACCESS_CURRENCY}</b>\n` +
      `Кошелёк: <code>${CRYPTO_WALLET}</code>\n` +
      `Ваш 12-значный код: <code>${code12}</code>\n\n` +
      `⚠️ Обязательно укажите код в комментарии/мемо перевода.\n` +
      `После отправки нажмите «Проверить оплату» — проверка занимает до 10 минут.`;

    const kb = new InlineKeyboard()
      .text("✅ Я оплатил — проверить", `check_access_${code12}`)
      .row()
      .url("📲 Открыть приложение", MINIAPP_URL)
      .row()
      .text("◀️ Назад", "ref");

    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
    await ctx.answerCallbackQuery();
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
    })
      .sort({ createdAt: -1 })
      .exec();

    if (!tx) {
      await ctx.answerCallbackQuery({ text: "Платёж не найден", show_alert: true });
      return;
    }

    if (tx.status === "confirmed") {
      if (!user.hasAccess) {
        user.hasAccess = true;
        user.accessGrantedAt = new Date();
        await user.save();
      }
      await ctx.answerCallbackQuery({ text: "Оплата подтверждена!" });
      await ctx.editMessageText(`🎉 Доступ активирован!\nТеперь можете пользоваться приложением.`, {
        reply_markup: kbMain(true),
        parse_mode: "HTML",
      });
    } else if (tx.status === "pending") {
      await ctx.answerCallbackQuery({ text: "Оплата ещё в обработке…", show_alert: true });
    } else if (tx.status === "failed" || tx.status === "expired") {
      await ctx.answerCallbackQuery({ text: "Оплата не прошла", show_alert: true });
    } else {
      await ctx.answerCallbackQuery({ text: "Статус неизвестен", show_alert: true });
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
  await ctx.reply("Главное меню:", { reply_markup: kbMain(hasAccess) });
});

/* ========= Добавляем совместимость с index.ts (launch/stop) ========= */
bot.launch = async () => {
  // твой index.ts ждёт метод .launch()
  await ensureMongo();
  // В grammy это .start()
  await (bot as GrammyBot<MyContext>).start();
};

// stop уже есть у grammy, просто пробрасываем
// (ничего доп. делать не надо)

/* ========= Дефолтный экспорт ========= */
export default bot;
