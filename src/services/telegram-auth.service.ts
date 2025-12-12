// backend/src/services/telegram-auth.service.ts
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram/tl';
import { ENV } from '../config/env.js';
import { getSmsCode } from './phone.service.js';
import fs from 'fs';
import path from 'path';

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

  // ✅ ИСПРАВЛЕНО: StringSession принимает строку, а не экземпляр
  const session = new StringSession(''); // пустая строка для новой сессии
  
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

    // ✅ ИСПРАВЛЕНО: Правильное получение session string
    const sessionString = session.save() as string;
    
    // Получаем информацию о созданном аккаунте
    const me = await client.getMe() as any;

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

  // ✅ ИСПРАВЛЕНО: StringSession принимает строку сессии
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
        new Api.account.UpdateProfile({
          firstName: updates.firstName,
          lastName: updates.lastName || '',
          about: updates.about || '',
        })
      );
      console.log('✅ Profile updated');
    }

    // Обновляем фото профиля
    if (updates.photoPath && fs.existsSync(updates.photoPath)) {
      // ✅ ИСПРАВЛЕНО: Правильная работа с файлами для GramJS
      const fileBuffer = fs.readFileSync(updates.photoPath);
      const fileName = path.basename(updates.photoPath);
      
      // Создаём объект CustomFile для GramJS
      const customFile = {
        name: fileName,
        size: fileBuffer.length,
        buffer: fileBuffer,
      };

      const uploadedFile = await client.uploadFile({
        file: customFile as any,
        workers: 1,
      });

      await client.invoke(
        new Api.photos.UploadProfilePhoto({
          file: uploadedFile,
        })
      );
      console.log('✅ Profile photo updated');
    }
  } catch (error: any) {
    console.error('❌ Failed to update profile:', error);
    throw error;
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