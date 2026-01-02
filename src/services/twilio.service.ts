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
  isoCountry: string;
}

/**
 * Поиск доступных номеров для покупки
 * Поддерживает разные страны и фильтры
 */
export async function searchAvailableNumbers(
  countryCode: string = 'US',
  options?: {
    areaCode?: string;
    contains?: string; // Поиск номеров содержащих определенные цифры
    limit?: number;
    smsEnabled?: boolean;
    voiceEnabled?: boolean;
  }
): Promise<PhoneNumber[]> {
  try {
    const searchOptions: any = {
      limit: options?.limit || 20,
      smsEnabled: options?.smsEnabled ?? true,
    };
    
    if (options?.areaCode) {
      const areaCodeNum = parseInt(options.areaCode, 10);
      if (!isNaN(areaCodeNum)) {
        searchOptions.areaCode = areaCodeNum;
      }
    }

    if (options?.contains) {
      searchOptions.contains = options.contains;
    }

    if (options?.voiceEnabled) {
      searchOptions.voiceEnabled = true;
    }

    const numbers = await client
      .availablePhoneNumbers(countryCode)
      .local.list(searchOptions);

    return numbers.map(num => ({
      phoneNumber: num.phoneNumber,
      friendlyName: num.friendlyName || num.phoneNumber,
      capabilities: {
        voice: num.capabilities.voice || false,
        sms: num.capabilities.sms || false,
        mms: num.capabilities.mms || false,
      },
      sid: '',
      monthlyPrice: 1.0, // $1/месяц для US номеров
      isoCountry: countryCode,
    }));
  } catch (error) {
    console.error('❌ Failed to search numbers:', error);
    throw new Error('Failed to search available numbers');
  }
}

/**
 * Покупка номера с привязкой к пользователю
 * Номер остается у пользователя пока он платит за аренду
 */
export async function purchaseNumber(
  phoneNumber: string,
  userId: string,
  webhookUrl?: string
): Promise<PhoneNumber> {
  try {
    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber,
      friendlyName: `User-${userId}-${Date.now()}`,
      // Webhooks для входящих сообщений и звонков
      smsUrl: webhookUrl || `${ENV.MINIAPP_URL}/api/webhooks/twilio/sms`,
      voiceUrl: webhookUrl || `${ENV.MINIAPP_URL}/api/webhooks/twilio/voice`,
      // Настройки для максимальной гибкости
      smsMethod: 'POST',
      voiceMethod: 'POST',
    });

    console.log(`✅ Purchased phone number: ${phoneNumber} for user ${userId}`);

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
      isoCountry: 'US',
    };
  } catch (error: any) {
    console.error('❌ Failed to purchase number:', error);
    
    // Обработка специфичных ошибок Twilio
    if (error.code === 21452) {
      throw new Error('Номер уже занят другим пользователем');
    } else if (error.code === 21608) {
      throw new Error('Номер больше недоступен для покупки');
    }
    
    throw new Error('Failed to purchase phone number: ' + error.message);
  }
}

/**
 * Получить все номера пользователя
 */
export async function getUserNumbers(userId: string): Promise<PhoneNumber[]> {
  try {
    const numbers = await client.incomingPhoneNumbers.list({ 
      limit: 1000 
    });

    // Фильтруем по friendlyName (содержит userId)
    const userNumbers = numbers.filter(num => 
      num.friendlyName?.includes(`User-${userId}`)
    );

    return userNumbers.map(num => ({
      phoneNumber: num.phoneNumber,
      friendlyName: num.friendlyName || num.phoneNumber,
      capabilities: {
        voice: num.capabilities.voice || false,
        sms: num.capabilities.sms || false,
        mms: num.capabilities.mms || false,
      },
      sid: num.sid,
      monthlyPrice: 1.0,
      isoCountry: 'US',
    }));
  } catch (error) {
    console.error('❌ Failed to get user numbers:', error);
    throw new Error('Failed to get user numbers');
  }
}

/**
 * Продлить аренду номера (автоматически при оплате)
 */
export async function renewNumber(
  sid: string,
  userId: string
): Promise<void> {
  try {
    // Twilio автоматически продлевает если есть баланс
    // Здесь мы просто проверяем что номер все еще активен
    const number = await client.incomingPhoneNumbers(sid).fetch();
    
    if (!number) {
      throw new Error('Number not found');
    }

    console.log(`✅ Number ${number.phoneNumber} renewed for user ${userId}`);
  } catch (error) {
    console.error('❌ Failed to renew number:', error);
    throw new Error('Failed to renew number');
  }
}

/**
 * Освободить номер (прекратить аренду)
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
): Promise<{ sid: string; status: string }> {
  try {
    const message = await client.messages.create({
      from,
      to,
      body,
    });

    console.log(`✅ SMS sent: ${message.sid}, status: ${message.status}`);
    
    return {
      sid: message.sid,
      status: message.status,
    };
  } catch (error) {
    console.error('❌ Failed to send SMS:', error);
    throw new Error('Failed to send SMS');
  }
}

/**
 * Получить историю сообщений для номера
 */
export async function getMessageHistory(
  phoneNumber: string,
  limit: number = 50
): Promise<any[]> {
  try {
    const messages = await client.messages.list({
      from: phoneNumber,
      limit,
    });

    return messages.map(msg => ({
      sid: msg.sid,
      to: msg.to,
      from: msg.from,
      body: msg.body,
      status: msg.status,
      direction: msg.direction,
      dateSent: msg.dateSent,
    }));
  } catch (error) {
    console.error('❌ Failed to get message history:', error);
    throw new Error('Failed to get message history');
  }
}

/**
 * Обновить webhook URL для номера
 */
export async function updateNumberWebhook(
  sid: string,
  smsUrl?: string,
  voiceUrl?: string
): Promise<void> {
  try {
    const updates: any = {};
    
    if (smsUrl) {
      updates.smsUrl = smsUrl;
      updates.smsMethod = 'POST';
    }
    
    if (voiceUrl) {
      updates.voiceUrl = voiceUrl;
      updates.voiceMethod = 'POST';
    }

    await client.incomingPhoneNumbers(sid).update(updates);
    
    console.log(`✅ Updated webhooks for number ${sid}`);
  } catch (error) {
    console.error('❌ Failed to update webhooks:', error);
    throw new Error('Failed to update webhooks');
  }
}