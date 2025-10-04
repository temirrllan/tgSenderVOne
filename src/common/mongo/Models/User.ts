// src/common/mongo/Models/User.ts
import { Schema, model, Document, Model } from "mongoose";

/**
 * Интерфейс документа User в базе
 */
export interface IUser extends Document {
  tgId: number;
  tgName?: string;
  tgUsername?: string;
  tgImage?: string;
  phone?: string | null;
  chatId?: number;
  languageCode?: string;
  balance: number;
  refBalance: number;
  ref?: string | null;
  referrals: string[];
  level: number;
  isBanned: boolean;
  extra?: Record<string, any>;
  // поля для одноразового web-токена (one-time token -> обмен на JWT)
  webToken?: string | null;
  webTokenExpires?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  lastSeenAt?: Date;
}

/**
 * Интерфейс модели (с добавленным статическим методом upsertFromTelegram)
 */
interface IUserModel extends Model<IUser> {
  upsertFromTelegram(payload: {
    tgId: number;
    chatId?: number;
    tgName?: string;
    tgUsername?: string;
    tgImage?: string;
    phone?: string | null;
    languageCode?: string;
    extra?: Record<string, any>;
  }): Promise<IUser>;
}

const userSchema = new Schema<IUser>(
  {
    tgId: { type: Number, required: true, unique: true },
    tgName: { type: String },
    tgUsername: { type: String },
    tgImage: { type: String, default: "" },
    phone: { type: String, default: null },
    chatId: { type: Number },
    languageCode: { type: String },
    balance: { type: Number, default: 0 },
    refBalance: { type: Number, default: 0 },
    ref: { type: String, default: null },
    referrals: [{ type: String, ref: "User" }],
    level: { type: Number, default: 0 },
    isBanned: { type: Boolean, default: false },
    extra: { type: Schema.Types.Mixed, default: {} },
    lastSeenAt: { type: Date, default: Date.now },

    // --- Добавленные поля: одноразовый токен для web (опционально)
    webToken: { type: String, default: null },
    webTokenExpires: { type: Date, default: null },
  },
  { timestamps: true }
);

// Индекс по tgId (на всякий случай)
//userSchema.index({ tgId: 1 }, { unique: true });

/**
 * Статический upsert: безопасно создаёт/обновляет пользователя по tgId
 * - сохраняет телефон только если он явно передан (чтобы не затирать уже записанный)
 */
userSchema.statics.upsertFromTelegram = async function (payload: {
  tgId: number;
  chatId?: number;
  tgName?: string;
  tgUsername?: string;
  tgImage?: string;
  phone?: string | null;
  languageCode?: string;
  extra?: Record<string, any>;
}) {
  const query = { tgId: payload.tgId };
  const update: any = {
    $set: {
      chatId: typeof payload.chatId !== "undefined" ? payload.chatId : undefined,
      tgName: typeof payload.tgName !== "undefined" ? payload.tgName : undefined,
      tgUsername: typeof payload.tgUsername !== "undefined" ? payload.tgUsername : undefined,
      tgImage: typeof payload.tgImage !== "undefined" ? payload.tgImage : undefined,
      languageCode: typeof payload.languageCode !== "undefined" ? payload.languageCode : undefined,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    }
  };

  // Сохраняем телефон только если явно передали (чтобы не затирать существующий null/номер)
  if (typeof payload.phone !== "undefined" && payload.phone !== null) {
    update.$set.phone = payload.phone;
  }

  if (payload.extra) {
    update.$set.extra = { ...(payload.extra || {}) };
  }

  const options = { upsert: true, new: true, setDefaultsOnInsert: true };

  try {
    // findOneAndUpdate с upsert — атомарно
    const doc = await (this as IUserModel).findOneAndUpdate(query, update, options).exec();
    return doc as IUser;
  } catch (err: any) {
    // При редкой гонке может быть DuplicateKey (11000) — вернём существующий документ
    if (err && (err.code === 11000 || err.codeName === "DuplicateKey")) {
      return (this as IUserModel).findOne(query).exec() as Promise<IUser>;
    }
    throw err;
  }
};

export const User = model<IUser, IUserModel>("User", userSchema);
export default User;
