// backend/src/services/telegram-auth.service.ts
// Упрощенная версия без сложных типов

import { TelegramClient } from 'telegram';
import { ENV } from '../config/env.js';
import { getSmsCode } from './phone.service.js';
import * as fs from 'fs';

// Динамические импорты для избежания проблем с типами
const StringSession = (await import('telegram/sessions/index.js')).StringSession;
const Api = (await import('telegram/tl/index.js')).Api;

const API_ID = Number(ENV.TELEGRAM_API_ID);
const API_HASH = ENV.TELEGRAM_API_HASH;

export interface TelegramAccountData {
  sessionString: string;
  userId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone: string;
}

/**
 * Создание нового Telegram аккаунта с помощью купленного номера
 */
export async function createTelegramAccount(
  phoneNumber: string
): Promise<TelegramAccountData> {
  if (!API_ID || !API_HASH) {
    throw new Error('Telegram API credentials not configured');
  }

  console.log('🤖 Starting Telegram account creation...');
  console.log('📞 Phone:', phoneNumber);

  const session = new StringSession('');
  const client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  try {
    console.log('🔌 Connecting to Telegram...');
    
    await client.start({
      phoneNumber: async () => phoneNumber,
      
      password: async () => {
        // Если есть 2FA - можно обработать здесь
        // Но для автоматических ботов 2FA не используется
        return '';
      },
      
      phoneCode: async () => {
        console.log('📨 Requesting SMS code from Plivo...');
        // Получаем код из SMS через Plivo API
        const code = await getSmsCode(phoneNumber);
        return code;
      },
      
      onError: (err: any) => {
        console.error('❌ Telegram auth error:', err);
      },
    });

    console.log('✅ Successfully connected to Telegram');

    // Получаем session string для сохранения
    const sessionString = client.session.save() as unknown as string;
    
    // Получаем информацию о созданном аккаунте
    const me: any = await client.getMe();

    console.log('✅ Account created:', {
      id: me.id?.toString() || 'unknown',
      username: me.username,
      phone: me.phone,
    });

    // Отключаемся
    await client.disconnect();

    return {
      sessionString,
      userId: me.id?.toString() || '',
      username: me.username || undefined,
      firstName: me.firstName || undefined,
      lastName: me.lastName || undefined,
      phone: me.phone || phoneNumber,
    };
  } catch (error: any) {
    console.error('❌ Failed to create Telegram account:', error);
    
    // Отключаемся в случае ошибки
    try {
      await client.disconnect();
    } catch (disconnectError) {
      console.error('Error disconnecting:', disconnectError);
    }
    
    throw new Error(`Telegram account creation failed: ${error.message}`);
  }
}

/**
 * Восстановление клиента из существующей сессии
 */
export async function restoreClient(sessionString: string): Promise<TelegramClient> {
  if (!API_ID || !API_HASH) {
    throw new Error('Telegram API credentials not configured');
  }

  const session = new StringSession(sessionString);
  const client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await client.connect();
  
  return client;
}

/**
 * Обновление профиля бота (имя, фото, био)
 */
export async function updateBotProfile(
  sessionString: string,
  updates: {
    firstName?: string;
    lastName?: string;
    about?: string;
    photoPath?: string;
  }
): Promise<void> {
  const client = await restoreClient(sessionString);

  try {
    // Обновляем имя через invoke
    if (updates.firstName !== undefined) {
      await client.invoke(
        new (Api as any).account.UpdateProfile({
          firstName: updates.firstName,
          lastName: updates.lastName || '',
          about: updates.about || '',
        })
      );
      console.log('✅ Profile updated');
    }

    // Обновляем фото профиля
    if (updates.photoPath && fs.existsSync(updates.photoPath)) {
      // Читаем файл как Buffer
      const fileBuffer = fs.readFileSync(updates.photoPath);
      
      const file = await client.uploadFile({
        file: fileBuffer,
        workers: 1,
      });

      await client.invoke(
        new (Api as any).photos.UploadProfilePhoto({
          file: file,
        })
      );
      console.log('✅ Profile photo updated');
    }
  } catch (error: any) {
    console.error('❌ Failed to update profile:', error);
  } finally {
    await client.disconnect();
  }
}

/**
 * Проверка валидности сессии
 */
export async function validateSession(sessionString: string): Promise<boolean> {
  try {
    const client = await restoreClient(sessionString);
    const me = await client.getMe();
    await client.disconnect();
    return !!me;
  } catch (error) {
    console.error('Session validation failed:', error);
    return false;
  }
}