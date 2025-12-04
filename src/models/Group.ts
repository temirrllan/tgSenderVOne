import { Schema, model, Document, Types } from "mongoose";

export type ChatType = "group" | "supergroup" | "channel";

export interface IGroup extends Document {
  owner: Types.ObjectId;          // пользователь, добавивший чат в систему
  chatId: number;                 // id чата/канала
  title?: string;
  type: ChatType;

  bots: Types.ObjectId[];         // какие рассыльщики привязаны
  createdAt: Date;
  updatedAt: Date;
}

const GroupSchema = new Schema<IGroup>(
  {
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    chatId: { type: Number, required: true, index: true },
    title: String,
    type: { type: String, enum: ["group", "supergroup", "channel"], required: true },
    bots: [{ type: Schema.Types.ObjectId, ref: "Bot" }],
  },
  { timestamps: true, versionKey: false }
);

GroupSchema.index({ owner: 1, chatId: 1 }, { unique: true });

export const Group = model<IGroup>("Group", GroupSchema);
