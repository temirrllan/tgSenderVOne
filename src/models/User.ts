// backend/src/models/User.ts
import { Schema, model, Document, Types } from "mongoose";

export type UserStatus = "active" | "blocked" | "pending";

export interface IUser extends Document {
  tgId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string; 

  status: UserStatus;
  hasAccess: boolean;
  
  // ✅ Добавляем баланс
  balance: number; // в долларах

  // Рефералка
  refCode: string;
  invitedBy?: Types.ObjectId;
  referrals: Types.ObjectId[];
  referralLevels: {
    lvl1: number;
    lvl2: number;
    lvl3: number;
    lvl4: number;
    lvl5: number;
  };
  referralBalance: number;
  referralEarnedTotal: number;

  // Приложение
  bots: Types.ObjectId[];
  accessGrantedAt?: Date;

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
    
    // ✅ Баланс (по умолчанию 0)
    balance: { type: Number, default: 0, min: 0 },

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

    isAdmin: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, versionKey: false }
);

UserSchema.pre("validate", function (next) {
  if (!this.refCode) {
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