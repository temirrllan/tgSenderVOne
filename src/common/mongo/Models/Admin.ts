import { Schema, model, Document } from "mongoose";

export type AdminRole = "superadmin" | "manager" | "support";

export interface IAdmin extends Document {
  login: string;
  passwordHash: string;       // храним только хэш
  role: AdminRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AdminSchema = new Schema<IAdmin>(
  {
    login: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["superadmin","manager","support"], default: "manager" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false }
);

export const Admin = model<IAdmin>("Admin", AdminSchema);
