// src/common/mongo/Models/User.ts
import { Schema, model, Document, Types } from "mongoose";

export type UserStatus = "active" | "blocked" | "pending";

export interface IUser extends Document {
  tgId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string; 

  status: UserStatus;
  hasAccess: boolean; // купил доступ к приложению

  // Рефералка
  refCode: string; // наш уникальный код для приглашений
  invitedBy?: Types.ObjectId; // кто пригласил (многоуровневость строится по цепочке)
  referrals: Types.ObjectId[]; // прямые (уровень 1)
  referralLevels: {
    lvl1: number;
    lvl2: number;
    lvl3: number;
    lvl4: number;
    lvl5: number;
  };
  referralBalance: number; // доступно к выводу/списанию
  referralEarnedTotal: number; // всего заработано по рефералке

  // Приложение
  bots: Types.ObjectId[]; // его рассыльщики
  accessGrantedAt?: Date;

  // Админский флаг
  isAdmin: boolean;

  createdAt: Date;
  updatedAt: Date;

  generateRefLink(botName: string): string;
}

const UserSchema = new Schema<IUser>(
  {
    tgId: { type: Number, required: true, unique: true, index: true },
    username: String,
    firstName: String,
    lastName: String,
    avatarUrl: String,

    status: {
      type: String,
      enum: ["active", "blocked", "pending"],
      default: "active",
      index: true,
    },
    hasAccess: { type: Boolean, default: false },

    refCode: { type: String, required: true, unique: true, index: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User" },
    referrals: [{ type: Schema.Types.ObjectId, ref: "User" }],
    referralLevels: {
      lvl1: { type: Number, default: 0 },
      lvl2: { type: Number, default: 0 },
      lvl3: { type: Number, default: 0 },
      lvl4: { type: Number, default: 0 },
      lvl5: { type: Number, default: 0 },
    },
    referralBalance: { type: Number, default: 0 },
    referralEarnedTotal: { type: Number, default: 0 },

    bots: [{ type: Schema.Types.ObjectId, ref: "Bot" }],
    accessGrantedAt: Date,

    // Новое поле — флаг администратора
    isAdmin: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

// Быстрая генерация человекочитаемого кода из tgId (можно заменить на любую стратегию)
UserSchema.pre("validate", function (next) {
  if (!this.refCode) {
    // base36 + контрольная пара
    const base = this.tgId?.toString(36).toUpperCase();
    const pad = ("" + Math.abs(this.tgId)).slice(-2).padStart(2, "0");
    this.refCode = `${base}${pad}`;
  }
  next();
});

UserSchema.methods.generateRefLink = function (botName: string) {
  return `https://t.me/${botName}?start=${this.refCode}`;
};

UserSchema.index({ invitedBy: 1 });
UserSchema.index({ "referralLevels.lvl1": -1 });

export const User = model<IUser>("User", UserSchema);
