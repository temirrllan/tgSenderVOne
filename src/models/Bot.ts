// backend/src/models/Bot.ts
import { Schema, model, Document, Types } from "mongoose";

export type BotStatus =
  | "awaiting_payment"   // создан, но еще не оплачен
  | "creating"           // в процессе создания (покупка номера + регистрация)
  | "active"             // работает и рассылает
  | "blocked"            // заблокирован
  | "deleted";           // мягкое удаление

export interface IBot extends Document {
  owner: Types.ObjectId;   // User
  
  // Telegram account данные
  phoneNumber?: string;        // +1234567890
  telegramUserId?: string;     // ID созданного аккаунта
  sessionString?: string;      // Сессия для подключения
  
  // Plivo данные
  plivoNumberId?: string;      // ID номера в Plivo
  plivoPurchaseId?: string;    // ID транзакции покупки
  monthlyRent?: number;        // Ежемесячная стоимость номера
  
  // Настройки бота
  username: string;            // Имя бота (не @username в Telegram)
  photoUrl?: string;
  messageText: string;
  interval: number;            // интервал в СЕКУНДАХ

  status: BotStatus;

  chats: number[];             // id чатов/каналов в Telegram
  groups?: Types.ObjectId[];   // связь с Group model

  lastRunAt?: Date;
  nextRunAt?: Date;

  sentCount: number;
  errorCount: number;

  createdAt: Date;
  updatedAt: Date;
}

const BotSchema = new Schema<IBot>(
  {
    owner: { 
      type: Schema.Types.ObjectId, 
      ref: "User", 
      required: true, 
      index: true 
    },
    
    // Telegram account
    phoneNumber: { 
      type: String, 
      sparse: true,  // не все боты имеют номер (старые)
    },
    telegramUserId: { 
      type: String, 
      sparse: true,
    },
    sessionString: { 
      type: String, 
      select: false,  // не возвращаем по умолчанию (безопасность)
    },
    
    // Plivo
    plivoNumberId: String,
    plivoPurchaseId: String,
    monthlyRent: Number,
    
    // Настройки
    username: { 
      type: String, 
      required: true, 
      trim: true, 
      index: true 
    },
    photoUrl: String,
    messageText: { 
      type: String, 
      required: true 
    },
    interval: { 
      type: Number, 
      required: true 
    },

    status: {
      type: String,
      enum: ["awaiting_payment", "creating", "active", "blocked", "deleted"],
      default: "awaiting_payment",
      index: true,
    },

    chats: { 
      type: [Number], 
      default: [] 
    },
    groups: [{ 
      type: Schema.Types.ObjectId, 
      ref: "Group" 
    }],

    lastRunAt: Date,
    nextRunAt: Date,

    sentCount: { 
      type: Number, 
      default: 0 
    },
    errorCount: { 
      type: Number, 
      default: 0 
    },
  },
  { 
    timestamps: true, 
    versionKey: false 
  }
);

// Индексы
BotSchema.index({ owner: 1, status: 1 });
BotSchema.index({ nextRunAt: 1 });
BotSchema.index({ phoneNumber: 1 }, { sparse: true });
BotSchema.index({ telegramUserId: 1 }, { sparse: true });

export const Bot = model<IBot>("Bot", BotSchema);