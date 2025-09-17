import { Schema, model, Document } from "mongoose";

export interface IBot extends Document {
  userId: object | string;
  token: string;
  username: string;
  firstName: string;
  secondName?: string;
  tgImage: string;
  sendText: string;
  phone?: string;
  timeout: number;
  monthlyLimit?: number;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const botSchema = new Schema<IBot>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    token: { type: String, required: true },
    username: { type: String, required: true },
    firstName: { type: String, required: true },
    secondName: { type: String },
    tgImage: { type: String, default: "" },
    sendText: { type: String, required: true },
    phone: { type: String },
    timeout: { type: Number, default: 1000 },
    monthlyLimit: { type: Number, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Bot = model<IBot>("Bot", botSchema);
