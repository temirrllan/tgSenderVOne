// backend/src/models/DeletedBot.ts
import { Schema, model, Document, Types, Model } from "mongoose";

export type BotStatus = "awaiting_payment" | "active" | "blocked" | "deleted";

export interface IDeletedBot extends Document {
  // Оригинальные данные бота
  originalBotId: Types.ObjectId;
  owner: Types.ObjectId;
  ownerTgId: number;  // ✅ Добавили tgId владельца
  username: string;
  photoUrl?: string;
  messageText: string;
  interval: number;
  status: BotStatus;
  chats: number[];
  groups?: Types.ObjectId[];
  
  // Статистика на момент удаления
  sentCount: number;
  errorCount: number;
  lastRunAt?: Date;
  nextRunAt?: Date;
  
  // Метаданные удаления
  deletedBy: Types.ObjectId;
  deletedByTgId: number;  // ✅ Добавили tgId того кто удалил
  deletedByType: "owner" | "admin";
  deletionReason?: string;
  
  // Даты
  botCreatedAt: Date;
  botUpdatedAt: Date;
  deletedAt: Date;
  
  createdAt: Date;
}

// ✅ Интерфейс для статических методов модели
interface IDeletedBotModel extends Model<IDeletedBot> {
  createFromBot(
    bot: any,
    deletedBy: Types.ObjectId,
    deletedByType: "owner" | "admin",
    deletionReason?: string
  ): Promise<IDeletedBot>;
}

const DeletedBotSchema = new Schema<IDeletedBot>(
  {
    // Оригинальные данные
    originalBotId: { 
      type: Schema.Types.ObjectId, 
      required: true, 
      index: true 
    },
    owner: { 
      type: Schema.Types.ObjectId, 
      ref: "User", 
      required: true, 
      index: true 
    },
    ownerTgId: {  // ✅ Добавили tgId владельца
      type: Number,
      required: true,
      index: true
    },
    username: { 
      type: String, 
      required: true, 
      trim: true 
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
      enum: ["awaiting_payment", "active", "blocked", "deleted"],
      required: true,
      default: "deleted"  // ✅ По умолчанию "deleted"
    },
    chats: { 
      type: [Number], 
      default: [] 
    },
    groups: [{ 
      type: Schema.Types.ObjectId, 
      ref: "Group" 
    }],
    
    // Статистика
    sentCount: { 
      type: Number, 
      default: 0 
    },
    errorCount: { 
      type: Number, 
      default: 0 
    },
    lastRunAt: Date,
    nextRunAt: Date,
    
    // Метаданные удаления
    deletedBy: { 
      type: Schema.Types.ObjectId, 
      ref: "User", 
      required: true,
      index: true 
    },
    deletedByTgId: {  // ✅ Добавили tgId того кто удалил
      type: Number,
      required: true,
      index: true
    },
    deletedByType: { 
      type: String, 
      enum: ["owner", "admin"], 
      required: true 
    },
    deletionReason: String,
    
    // Даты
    botCreatedAt: { 
      type: Date, 
      required: true 
    },
    botUpdatedAt: { 
      type: Date, 
      required: true 
    },
    deletedAt: { 
      type: Date, 
      required: true, 
      default: Date.now,
      index: true 
    },
  },
  { 
    timestamps: true,
    versionKey: false,
    collection: "deleted_bots"
  }
);

// Индексы для частых запросов
DeletedBotSchema.index({ owner: 1, deletedAt: -1 });
DeletedBotSchema.index({ deletedBy: 1, deletedAt: -1 });
DeletedBotSchema.index({ deletedAt: -1 });
DeletedBotSchema.index({ ownerTgId: 1 });  // ✅ Индекс по tgId владельца
DeletedBotSchema.index({ deletedByTgId: 1 });  // ✅ Индекс по tgId удалившего

// ✅ Статический метод с правильной типизацией
DeletedBotSchema.statics.createFromBot = async function(
  bot: any, 
  deletedBy: Types.ObjectId, 
  deletedByType: "owner" | "admin",
  deletionReason?: string
): Promise<IDeletedBot> {
  // ✅ Получаем пользователей для tgId
  const { User } = await import("./User.js");
  
  const [ownerDoc, deleterDoc] = await Promise.all([
    User.findById(bot.owner).select("tgId").lean(),
    User.findById(deletedBy).select("tgId").lean()
  ]);
  
  if (!ownerDoc || !deleterDoc) {
    throw new Error("Owner or deleter not found");
  }
  
  return this.create({
    originalBotId: bot._id,
    owner: bot.owner,
    ownerTgId: ownerDoc.tgId,  // ✅ Сохраняем tgId владельца
    username: bot.username,
    photoUrl: bot.photoUrl,
    messageText: bot.messageText,
    interval: bot.interval,
    status: "deleted",  // ✅ Принудительно ставим "deleted"
    chats: bot.chats || [],
    groups: bot.groups || [],
    sentCount: bot.sentCount || 0,
    errorCount: bot.errorCount || 0,
    lastRunAt: bot.lastRunAt,
    nextRunAt: bot.nextRunAt,
    deletedBy,
    deletedByTgId: deleterDoc.tgId,  // ✅ Сохраняем tgId удалившего
    deletedByType,
    deletionReason,
    botCreatedAt: bot.createdAt,
    botUpdatedAt: bot.updatedAt,
    deletedAt: new Date(),
  });
};

// ✅ Экспортируем с правильным типом модели
export const DeletedBot = model<IDeletedBot, IDeletedBotModel>("DeletedBot", DeletedBotSchema);