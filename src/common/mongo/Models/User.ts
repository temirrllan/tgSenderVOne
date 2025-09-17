import { Schema, model, Document } from "mongoose";

export interface IUser extends Document {
  tgId: number;
  tgName?: string;
  tgUsername?: string;
  tgImage: string;
  balance: number;
  refBalance: number;
  level: number;
  ref: string;
  referrals: string[];
  isBanned: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const userSchema = new Schema<IUser>(
  {
    tgId: { type: Number, required: true, unique: true },
    tgName: { type: String },
    tgUsername: { type: String },
    tgImage: { type: String, default: "" },
    balance: { type: Number, default: 0 },
    refBalance: { type: Number, default: 0 },
    ref: { type: String, default: null },
    referrals: [{ type: String, ref: "User" }],
    level: { type: Number, default: 0 },
    isBanned: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const User = model<IUser>("User", userSchema);
