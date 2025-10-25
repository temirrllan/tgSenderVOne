import { Schema, model, Types, Document } from "mongoose";

export type BotStatus =
  | "awaiting_payment"   // создан, но еще не оплачен
  | "active"             // работает и рассылает
  | "paused"             // временно остановлен владельцем/админом
  | "stopped";           // завершен/удален

export type IntervalKey = "1h"|"2h"|"3h"|"4h"|"5h"|"6h"|"12h"|"24h";

export interface IBot extends Document {
  owner: Types.ObjectId;             // User
  username: string;                  // @username рассыльщика (по ТЗ)
  photoUrl?: string;
  messageText: string;
  interval: IntervalKey;

  status: BotStatus;
  chats: number[];                   // id чатов/каналов в Telegram, где бот работает
  groups?: Types.ObjectId[];         // ссылки на Group документы (для админки/аналитики)

  lastRunAt?: Date;
  nextRunAt?: Date;

  // для счетчиков/аналитики
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
    interval: { type: String, enum: ["1h","2h","3h","4h","5h","6h","12h","24h"], required: true },

    status: { type: String, enum: ["awaiting_payment","active","paused","stopped"], default: "awaiting_payment", index: true },
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
BotSchema.index({ nextRunAt: 1 }); // планировщик рассылок

export const Bot = model<IBot>("Bot", BotSchema);
