// backend/src/services/twilio.service.ts
import twilio from 'twilio';
import { ENV } from '../config/env.js';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export interface PhoneNumber {
  phoneNumber: string;
  friendlyName: string;
  capabilities: {
    voice: boolean;
    sms: boolean;
    mms: boolean;
  };
  sid: string;
  monthlyPrice: number;
}

/**
 * Поиск доступных номеров для покупки
 */
export async function searchAvailableNumbers(
  countryCode: string = 'US',
  areaCode?: string
): Promise<PhoneNumber[]> {
  try {
    const options: any = {
      limit: 20,
      smsEnabled: true,
    };
    
    // Twilio ожидает number для areaCode
    if (areaCode) {
      const areaCodeNum = parseInt(areaCode, 10);
      if (!isNaN(areaCodeNum)) {
        options.areaCode = areaCodeNum;
      }
    }

    const numbers = await client
      .availablePhoneNumbers(countryCode)
      .local.list(options);

    return numbers.map(num => ({
      phoneNumber: num.phoneNumber,
      friendlyName: num.friendlyName || num.phoneNumber,
      capabilities: {
        voice: num.capabilities.voice || false,
        sms: num.capabilities.sms || false, // ✅ lowercase
        mms: num.capabilities.mms || false, // ✅ lowercase
      },
      sid: '', // Будет присвоен после покупки
      monthlyPrice: 1.0, // Примерная цена, нужно получить из Twilio Pricing API
    }));
  } catch (error) {
    console.error('❌ Failed to search numbers:', error);
    throw new Error('Failed to search available numbers');
  }
}

/**
 * Покупка номера
 */
export async function purchaseNumber(
  phoneNumber: string,
  userId: string
): Promise<PhoneNumber> {
  try {
    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber,
      friendlyName: `Bot-${userId}-${Date.now()}`,
      smsUrl: `${ENV.MINIAPP_URL}/api/webhooks/twilio/sms`, // Webhook для входящих SMS
      voiceUrl: `${ENV.MINIAPP_URL}/api/webhooks/twilio/voice`, // Webhook для звонков
    });

    return {
      phoneNumber: purchased.phoneNumber,
      friendlyName: purchased.friendlyName || purchased.phoneNumber,
      capabilities: {
        voice: purchased.capabilities.voice || false,
        sms: purchased.capabilities.sms || false,
        mms: purchased.capabilities.mms || false,
      },
      sid: purchased.sid,
      monthlyPrice: 1.0,
    };
  } catch (error) {
    console.error('❌ Failed to purchase number:', error);
    throw new Error('Failed to purchase phone number');
  }
}

/**
 * Получить список всех купленных номеров
 */
export async function getOwnedNumbers(): Promise<PhoneNumber[]> {
  try {
    const numbers = await client.incomingPhoneNumbers.list({ limit: 100 });

    return numbers.map(num => ({
      phoneNumber: num.phoneNumber,
      friendlyName: num.friendlyName || num.phoneNumber,
      capabilities: {
        voice: num.capabilities.voice || false,
        sms: num.capabilities.sms || false,
        mms: num.capabilities.mms || false,
      },
      sid: num.sid,
      monthlyPrice: 1.0,
    }));
  } catch (error) {
    console.error('❌ Failed to get owned numbers:', error);
    throw new Error('Failed to get owned numbers');
  }
}

/**
 * Отменить номер (освободить)
 */
export async function releaseNumber(sid: string): Promise<void> {
  try {
    await client.incomingPhoneNumbers(sid).remove();
    console.log(`✅ Released phone number: ${sid}`);
  } catch (error) {
    console.error('❌ Failed to release number:', error);
    throw new Error('Failed to release phone number');
  }
}

/**
 * Отправить SMS с купленного номера
 */
export async function sendSMS(
  from: string,
  to: string,
  body: string
): Promise<void> {
  try {
    const message = await client.messages.create({
      from,
      to,
      body,
    });

    console.log(`✅ SMS sent: ${message.sid}`);
  } catch (error) {
    console.error('❌ Failed to send SMS:', error);
    throw new Error('Failed to send SMS');
  }
}