// backend/src/models/PhoneNumber.ts
import { Schema, model, Document, Types } from "mongoose";

export type PhoneStatus = "active" | "released" | "blocked";

export interface IPhoneNumber extends Document {
  owner: Types.ObjectId; // User
  phoneNumber: string; // +1234567890
  friendlyName: string;
  
  // Twilio data
  twilioSid: string;
  twilioAccountSid?: string;
  
  // Capabilities
  smsEnabled: boolean;
  voiceEnabled: boolean;
  mmsEnabled: boolean;
  
  // Status
  status: PhoneStatus;
  
  // Pricing
  monthlyPrice: number; // $1.00
  currency: string; // USD
  
  // Usage tracking
  smsCount: number;
  callsCount: number;
  lastUsedAt?: Date;
  
  // Billing
  purchasedAt: Date;
  nextBillingDate: Date;
  totalSpent: number;
  
  createdAt: Date;
  updatedAt: Date;
}

const PhoneNumberSchema = new Schema<IPhoneNumber>(
  {
    owner: { 
      type: Schema.Types.ObjectId, 
      ref: "User", 
      required: true, 
      index: true 
    },
    phoneNumber: { 
      type: String, 
      required: true, 
      unique: true,
      index: true 
    },
    friendlyName: { 
      type: String, 
      required: true 
    },
    
    twilioSid: { 
      type: String, 
      required: true, 
      unique: true 
    },
    twilioAccountSid: String,
    
    smsEnabled: { 
      type: Boolean, 
      default: true 
    },
    voiceEnabled: { 
      type: Boolean, 
      default: false 
    },
    mmsEnabled: { 
      type: Boolean, 
      default: false 
    },
    
    status: {
      type: String,
      enum: ["active", "released", "blocked"],
      default: "active",
      index: true,
    },
    
    monthlyPrice: { 
      type: Number, 
      required: true 
    },
    currency: { 
      type: String, 
      default: "USD" 
    },
    
    smsCount: { 
      type: Number, 
      default: 0 
    },
    callsCount: { 
      type: Number, 
      default: 0 
    },
    lastUsedAt: Date,
    
    purchasedAt: { 
      type: Date, 
      required: true, 
      default: Date.now 
    },
    nextBillingDate: { 
      type: Date, 
      required: true 
    },
    totalSpent: { 
      type: Number, 
      default: 0 
    },
  },
  { timestamps: true, versionKey: false }
);

// Индексы
PhoneNumberSchema.index({ owner: 1, status: 1 });
PhoneNumberSchema.index({ nextBillingDate: 1 });
PhoneNumberSchema.index({ twilioSid: 1 });

// Метод для проверки активности
PhoneNumberSchema.methods.isActive = function(): boolean {
  return this.status === "active";
};

// Метод для записи использования
PhoneNumberSchema.methods.recordUsage = async function(type: "sms" | "call"): Promise<void> {
  if (type === "sms") {
    this.smsCount += 1;
  } else {
    this.callsCount += 1;
  }
  this.lastUsedAt = new Date();
  await this.save();
};

export const PhoneNumber = model<IPhoneNumber>("PhoneNumber", PhoneNumberSchema);