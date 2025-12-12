// backend/src/services/phone.service.ts
import axios from 'axios';
import { ENV } from '../config/env.js';

const PLIVO_API_URL = 'https://api.plivo.com/v1/Account';

export interface PhoneNumberData {
  phoneNumber: string;
  monthlyRent: number;
  purchaseId: string;
}

/**
 * Покупка номера телефона через Plivo
 */
export async function buyPhoneNumber(countryCode: string = 'US'): Promise<PhoneNumberData> {
  const authId = ENV.PLIVO_AUTH_ID;
  const authToken = ENV.PLIVO_AUTH_TOKEN;

  if (!authId || !authToken) {
    throw new Error('PLIVO credentials not configured');
  }

  try {
    console.log('📞 Searching for available phone numbers...');

    // 1. Поиск доступного номера
    const searchResponse = await axios.get(
      `${PLIVO_API_URL}/${authId}/PhoneNumber/`,
      {
        auth: {
          username: authId,
          password: authToken,
        },
        params: {
          country_iso: countryCode,
          type: 'local',
          services: 'sms,voice',
          limit: 1,
        }
      }
    );

    const availableNumbers = searchResponse.data.objects;
    
    if (!availableNumbers || availableNumbers.length === 0) {
      throw new Error('No available numbers in selected country');
    }

    const availableNumber = availableNumbers[0];
    
    console.log('✅ Found number:', availableNumber.number);

    // 2. Покупка номера
    console.log('💰 Purchasing number...');
    
    const buyResponse = await axios.post(
      `${PLIVO_API_URL}/${authId}/PhoneNumber/${availableNumber.number}/`,
      {},
      {
        auth: {
          username: authId,
          password: authToken,
        }
      }
    );

    console.log('✅ Number purchased successfully');

    return {
      phoneNumber: availableNumber.number,
      monthlyRent: parseFloat(availableNumber.monthly_rent_rate || '0'),
      purchaseId: buyResponse.data.api_id || buyResponse.data.message_uuid || '',
    };
  } catch (error: any) {
    console.error('❌ Failed to buy phone number:', error.response?.data || error.message);
    throw new Error(`Phone purchase failed: ${error.response?.data?.error || error.message}`);
  }
}

/**
 * Получение SMS кода через Plivo API
 */
export async function getSmsCode(phoneNumber: string): Promise<string> {
  const authId = ENV.PLIVO_AUTH_ID;
  const authToken = ENV.PLIVO_AUTH_TOKEN;

  if (!authId || !authToken) {
    throw new Error('PLIVO credentials not configured');
  }

  console.log('📨 Waiting for SMS code...');

  const maxAttempts = 30; // 5 минут (30 * 10 секунд)
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.get(
        `${PLIVO_API_URL}/${authId}/Message/`,
        {
          auth: {
            username: authId,
            password: authToken,
          },
          params: {
            to_number: phoneNumber,
            limit: 1,
            message_direction: 'inbound',
          }
        }
      );

      const messages = response.data.objects;
      
      if (messages && messages.length > 0) {
        const lastMessage = messages[0];
        
        // Ищем код Telegram (обычно 5 цифр)
        const codeMatch = lastMessage.text.match(/\b\d{5}\b/);
        
        if (codeMatch) {
          console.log('✅ SMS code received:', codeMatch[0]);
          return codeMatch[0];
        }
      }

      console.log(`⏳ Attempt ${attempt}/${maxAttempts} - no code yet...`);
      
    } catch (error: any) {
      console.error('Error fetching SMS:', error.response?.data || error.message);
    }

    // Ждём 10 секунд перед следующей попыткой
    await new Promise(resolve => setTimeout(resolve, 10000));
  }

  throw new Error('SMS code timeout - no code received within 5 minutes');
}

/**
 * Освобождение (удаление) номера телефона
 */
export async function releasePhoneNumber(phoneNumber: string): Promise<void> {
  const authId = ENV.PLIVO_AUTH_ID;
  const authToken = ENV.PLIVO_AUTH_TOKEN;

  if (!authId || !authToken) {
    throw new Error('PLIVO credentials not configured');
  }

  try {
    await axios.delete(
      `${PLIVO_API_URL}/${authId}/PhoneNumber/${phoneNumber}/`,
      {
        auth: {
          username: authId,
          password: authToken,
        }
      }
    );

    console.log('✅ Phone number released:', phoneNumber);
  } catch (error: any) {
    console.error('❌ Failed to release number:', error.response?.data || error.message);
    throw error;
  }
}