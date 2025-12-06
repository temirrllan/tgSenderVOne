// src/tgBot/services/referral.service.ts
import { User } from "../../models/User.js";

/**
 * Получает статистику рефералов для пользователя
 */
export async function getReferralStats(userId: any) {
  const refs = await User.find({ invitedBy: userId })
    .select("username firstName tgId")
    .lean();

  const refsList = refs.length === 0
    ? "— пока нет"
    : refs
        .slice(0, 20)
        .map((r, i) => 
          `${i + 1}. ${r.username ? "@" + r.username : r.firstName || r.tgId}`
        )
        .join("\n");

  return {
    refs,
    refsList,
    count: refs.length
  };
}