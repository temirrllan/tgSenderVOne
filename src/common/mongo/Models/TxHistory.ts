import { Schema, model, Document } from "mongoose";

export interface ITxHistory extends Document {
  userId: object | string;
  fromAddress: string;
  toAddress: string;
  amount: number;
  tokenSymbol: string;
  status: "pending" | "confirmed" | "failed";
  createdAt?: Date;
  updatedAt?: Date;
}

const txHistorySchema = new Schema<ITxHistory>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    fromAddress: { type: String, required: true },
    toAddress: { type: String, required: true },
    amount: { type: Number, required: true },
    tokenSymbol: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "confirmed", "failed"],
      default: "pending",
    },
  },
  { timestamps: true }
);

export const TxHistory = model<ITxHistory>("TxHistory", txHistorySchema);
