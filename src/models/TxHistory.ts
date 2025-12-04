import { Schema, model, Document, Types } from "mongoose";

export type TxStatus = "pending" | "confirmed" | "failed" | "expired";
export type TxType =
  | "ACCESS_PURCHASE"     // покупка доступа к приложению
  | "BOT_PURCHASE"        // покупка/продление конкретного бота
  | "REFERRAL_INCOME"     // начисление по рефералке
  | "REFERRAL_PAYOUT"     // вывод/списание реф. средств
  | "OTHER";

export interface ITxHistory extends Document {
  user: Types.ObjectId;             // кто инициировал/получатель
  type: TxType;
  status: TxStatus;

  amount: number;                   // сумма в crypto (в USDT и т.п.)
  currency: string;                 // 'USDT','BTC','TON', ...

  wallet: string;                   // кошелек, куда отправляют
  code12: string;                   // наш 12-значный код для сопоставления платежа
  txHash?: string;                  // хеш от сети, если доступен

  // связь с ботом (для покупок ботов)
  bot?: Types.ObjectId;

  // для рефералок
  referralLevel?: number;           // на каком уровне начисление

  // служебное
  meta?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  confirmedAt?: Date;

  // удобные методы (опционально)
  markConfirmed(txHash?: string): Promise<ITxHistory>;
  markFailed(): Promise<ITxHistory>;
}

const code12Validator = /^\d{12}$/;

const TxHistorySchema = new Schema<ITxHistory>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["ACCESS_PURCHASE","BOT_PURCHASE","REFERRAL_INCOME","REFERRAL_PAYOUT","OTHER"], required: true, index: true },
    status: { type: String, enum: ["pending","confirmed","failed","expired"], default: "pending", index: true },

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },

    wallet: { type: String, required: true },
    code12: {
      type: String,
      required: true,
      validate: { validator: (v: string) => code12Validator.test(v), message: "code12 must be 12 digits" },
      index: true,
    },
    txHash: { type: String, index: true },

    bot: { type: Schema.Types.ObjectId, ref: "Bot" },
    referralLevel: Number,

    meta: { type: Schema.Types.Mixed, default: {} },
    confirmedAt: Date,
  },
  { timestamps: true, versionKey: false }
);

/* =========================
   Индексы (помогают выборкам)
   ========================= */
// уникальность активных ожидающих кодов на один кошелёк
TxHistorySchema.index(
  { wallet: 1, code12: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);
// частые выборки
TxHistorySchema.index({ createdAt: -1 });
TxHistorySchema.index({ user: 1, type: 1, status: 1 });

/* =========================
   Методы-инструменты
   ========================= */
TxHistorySchema.methods.markConfirmed = function (this: ITxHistory, txHash?: string) {
  this.status = "confirmed";
  if (txHash) this.txHash = txHash;
  this.confirmedAt = new Date();
  return this.save();
};

TxHistorySchema.methods.markFailed = function (this: ITxHistory) {
  this.status = "failed";
  return this.save();
};

// (по желанию) статик-генератор 12-значного кода — если хочешь вызывать из сервисов
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(TxHistorySchema.statics as any).generateCode12 = function (): string {
  return Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join("");
};

export const TxHistory = model<ITxHistory>("TxHistory", TxHistorySchema);
