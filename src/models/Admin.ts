import { Schema, model, Document } from "mongoose";

export type AdminRole = "superadmin" | "manager" | "support";

export interface IAdmin extends Document {
  telegramId: number;      // Telegram ID для входа
  username?: string;       // @username
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  
  role: AdminRole;
  isActive: boolean;
  
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AdminSchema = new Schema<IAdmin>(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: String,
    firstName: String,
    lastName: String,
    avatarUrl: String,
    
    role: { 
      type: String, 
      enum: ["superadmin", "manager", "support"], 
      default: "manager", 
      index: true 
    },
    isActive: { type: Boolean, default: true, index: true },
    
    lastLoginAt: Date,
  },
  { timestamps: true, versionKey: false }
);

// Индекс для быстрого поиска активных админов
AdminSchema.index({ isActive: 1, role: 1 });

export const Admin = model<IAdmin>("Admin", AdminSchema);