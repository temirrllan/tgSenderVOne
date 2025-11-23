// src/common/mongo/Models/Bot.ts
import { Schema, model, Types, Document } from "mongoose";

export type BotStatus =
  | "awaiting_payment"   // создан, но еще не оплачен
  | "active"             // работает и рассылает
  | "blocked"            // заблокирован
  | "deleted";           // мягкое удаление

export interface IBot extends Document {
  owner: Types.ObjectId;   // User
  username: string;        // @username рассыльщика
  photoUrl?: string;
  messageText: string;

  // интервал в СЕКУНДАХ (3600, 7200, ... как в API)
  interval: number;

  status: BotStatus;

  chats: number[];         // id чатов/каналов в Telegram, где бот работает
  groups?: Types.ObjectId[];

  lastRunAt?: Date;
  nextRunAt?: Date;

  sentCount: number;
  errorCount: number;

  createdAt: Date;
  updatedAt: Date;
}

const BotSchema = new Schema<IBot>(
  {
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    username: { type: String, required: true, trim: true, index: true },
    photoUrl: String,
    messageText: { type: String, required: true },

    // интервал рассылки в секундах
    interval: { type: Number, required: true },

    status: {
      type: String,
      enum: ["awaiting_payment", "active", "blocked", "deleted"],
      default: "awaiting_payment",
      index: true,
    },

    chats: { type: [Number], default: [] },
    groups: [{ type: Schema.Types.ObjectId, ref: "Group" }],

    lastRunAt: Date,
    nextRunAt: Date,

    sentCount: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false }
);

BotSchema.index({ owner: 1, status: 1 });
BotSchema.index({ nextRunAt: 1 });

export const Bot = model<IBot>("Bot", BotSchema);
