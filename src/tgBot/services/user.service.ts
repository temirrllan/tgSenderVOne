// src/tgBot/services/user.service.ts
import { Types } from "mongoose";
import { User } from "../../models/User.js";

/**
 * Создаёт или обновляет пользователя в БД
 */
export async function findOrCreateUser(tg: any, payload?: string) {
  let user = await User.findOne({ tgId: tg.id });

  const baseProfile = {
    username: tg.username ?? "",
    firstName: tg.first_name ?? "",
    lastName: tg.last_name ?? "",
  };

  if (!user) {
    // Создаём нового пользователя
    user = new User({
      tgId: tg.id,
      ...baseProfile,
      status: "active",
      hasAccess: false,
    });

    // Обрабатываем реферальный код
    if (payload) {
      const inviter = await User.findOne({ refCode: payload });
      if (inviter && inviter.tgId !== tg.id) {
        user.invitedBy = inviter._id as Types.ObjectId;

        // Обновляем инвайтера
        inviter.referrals.push(user._id as Types.ObjectId);
        inviter.referralLevels.lvl1 += 1;
        await inviter.save();

        // Обновляем уровни 2-5
        await updateReferralChain(inviter, 2);
      }
    }

    await user.save();
  } else {
    // Обновляем существующего
    user.username = baseProfile.username || (user.username ?? "");
    user.firstName = baseProfile.firstName || (user.firstName ?? "");
    user.lastName = baseProfile.lastName || (user.lastName ?? "");

    // Привязываем реферала если это первый вход с payload
    if (payload && !user.invitedBy) {
      const inviter = await User.findOne({ refCode: payload });
      if (inviter && inviter.tgId !== tg.id) {
        user.invitedBy = inviter._id as Types.ObjectId;
        await user.save();

        inviter.referrals.push(user._id as Types.ObjectId);
        inviter.referralLevels.lvl1 += 1;
        await inviter.save();

        await updateReferralChain(inviter, 2);
      }
    } else {
      await user.save();
    }
  }

  return user;
}

/**
 * Обновляет реферальную цепочку (уровни 2-5)
 */
async function updateReferralChain(startUser: any, startLevel: number) {
  let parent = startUser;
  
  for (let level = startLevel; level <= 5; level++) {
    if (!parent.invitedBy) break;
    
    const up = await User.findById(parent.invitedBy);
    if (!up) break;
    
    (up.referralLevels as any)[`lvl${level}`] = 
      ((up.referralLevels as any)[`lvl${level}`] || 0) + 1;
    await up.save();
    
    parent = up;
  }
}