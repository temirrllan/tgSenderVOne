// src/tgBot/services/avatar.service.ts

const BOT_TOKEN = process.env.BOT_TOKEN || "";

/**
 * Загружает аватар пользователя из Telegram и сохраняет в user.avatarUrl
 */
export async function ensureUserAvatar(user: any, ctx: any): Promise<void> {
  try {
    // Если аватар уже есть — не трогаем
    if (user.avatarUrl && typeof user.avatarUrl === "string") {
      return;
    }

    const telegramUser = ctx.from;
    if (!telegramUser) return;

    // Получаем фото профиля
    const photos = await ctx.api.getUserProfilePhotos(telegramUser.id, { 
      limit: 1 
    });

    // Проверяем что фото есть
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

    const firstSize = photos.photos[0][0];
    if (!firstSize?.file_id) return;

    // Получаем file_path
    const file = await ctx.api.getFile(firstSize.file_id);
    if (!file?.file_path) return;

    // Формируем URL
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

    // Сохраняем в БД
    user.avatarUrl = url;
    await user.save();

    console.log("✅ Saved avatarUrl for user", user.tgId, url);
  } catch (err) {
    console.error("❌ ensureUserAvatar error:", err);
  }
}