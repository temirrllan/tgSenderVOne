import { Schema, model, Types, Document } from "mongoose";

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
    code12: { type: String, required: true, validate: { validator: (v:string)=>code12Validator.test(v), message: "code12 must be 12 digits" }, index: true },
    txHash: { type: String, index: true },

    bot: { type: Schema.Types.ObjectId, ref: "Bot" },
    referralLevel: Number,

    meta: Schema.Types.Mixed,
    confirmedAt: Date,
  },
  { timestamps: true, versionKey: false }
);

// Уникальность активных ожидающих кодов на один кошелек
TxHistorySchema.index({ wallet: 1, code12: 1, status: 1 }, { unique: true, partialFilterExpression: { status: "pending" } });

export const TxHistory = model<ITxHistory>("TxHistory", TxHistorySchema);
