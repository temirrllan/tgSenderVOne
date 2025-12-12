// backend/src/services/bot-sender.service.ts
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram/tl';
import { Bot } from '../models/Bot.js';
import { ENV } from '../config/env.js';

const API_ID = Number(ENV.TELEGRAM_API_ID);
const API_HASH = ENV.TELEGRAM_API_HASH;

/**
 * Отправка сообщения от имени бота в чат/канал
 */
export async function sendMessageFromBot(
  botId: string,
  chatId: number | string,
  message: string
): Promise<void> {
  const bot = await Bot.findById(botId);
  
  if (!bot) {
    throw new Error('Bot not found');
  }

  if (!bot.sessionString) {
    throw new Error('Bot session not found');
  }

  console.log(`📤 Sending message from bot @${bot.username} to chat ${chatId}`);

  // ✅ ИСПРАВЛЕНО: StringSession принимает строку сессии
  const session = new StringSession(bot.sessionString);
  
  const client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  try {
    await client.connect();
    
    // Отправляем сообщение
    await client.sendMessage(chatId, { message });
    
    console.log(`✅ Message sent successfully`);
    
    // Обновляем статистику
    bot.sentCount = (bot.sentCount || 0) + 1;
    bot.lastRunAt = new Date();
    await bot.save();
    
  } catch (error: any) {
    console.error('❌ Failed to send message:', error.message);
    
    // Обновляем счетчик ошибок
    bot.errorCount = (bot.errorCount || 0) + 1;
    await bot.save();
    
    throw new Error(`Message sending failed: ${error.message}`);
  } finally {
    await client.disconnect();
  }
}

/**
 * Массовая рассылка по всем чатам бота
 */
export async function broadcastMessage(botId: string): Promise<void> {
  const bot = await Bot.findById(botId).populate('groups');
  
  if (!bot) {
    throw new Error('Bot not found');
  }

  if (bot.status !== 'active') {
    console.log(`⏸️  Bot ${bot.username} is not active, skipping broadcast`);
    return;
  }

  console.log(`📢 Starting broadcast for bot @${bot.username}`);
  console.log(`   Message: ${bot.messageText.slice(0, 50)}...`);
  console.log(`   Chats count: ${bot.chats?.length || 0}`);

  // ✅ ИСПРАВЛЕНО: StringSession принимает строку сессии
  const session = new StringSession(bot.sessionString || '');
  
  const client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  let successCount = 0;
  let errorCount = 0;

  try {
    await client.connect();
    
    // Отправляем во все чаты
    const chats = bot.chats || [];
    
    for (const chatId of chats) {
      try {
        await client.sendMessage(chatId, { message: bot.messageText });
        successCount++;
        console.log(`  ✅ Sent to chat ${chatId}`);
        
        // Задержка между отправками (антиспам)
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error: any) {
        errorCount++;
        console.error(`  ❌ Failed to send to chat ${chatId}:`, error.message);
      }
    }
    
    console.log(`📊 Broadcast complete: ${successCount} success, ${errorCount} errors`);
    
    // Обновляем статистику
    bot.sentCount = (bot.sentCount || 0) + successCount;
    bot.errorCount = (bot.errorCount || 0) + errorCount;
    bot.lastRunAt = new Date();
    bot.nextRunAt = new Date(Date.now() + bot.interval * 1000);
    await bot.save();
    
  } finally {
    await client.disconnect();
  }
}

/**
 * Добавление бота в группу/канал
 */
export async function joinChat(
  botId: string,
  inviteLink: string
): Promise<{ chatId: number; title: string }> {
  const bot = await Bot.findById(botId);
  
  if (!bot) {
    throw new Error('Bot not found');
  }

  // ✅ ИСПРАВЛЕНО: StringSession принимает строку сессии
  const session = new StringSession(bot.sessionString || '');
  
  const client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  try {
    await client.connect();
    
    // Присоединяемся к чату по ссылке
    const result = await client.invoke(
      new Api.messages.ImportChatInvite({
        hash: inviteLink.split('/').pop() || inviteLink,
      })
    ) as any;

    let chat: any;
    if (result.chats && result.chats.length > 0) {
      chat = result.chats[0];
    }

    if (!chat) {
      throw new Error('Failed to join chat');
    }

    const chatId = Number('-' + chat.id.toString());
    const title = chat.title || 'Unknown';

    console.log(`✅ Bot joined chat: ${title} (${chatId})`);

    // Добавляем в список чатов бота
    if (!bot.chats.includes(chatId)) {
      bot.chats.push(chatId);
      await bot.save();
    }

    return { chatId, title };
  } finally {
    await client.disconnect();
  }
}

/**
 * Получение информации о боте
 */
export async function getBotInfo(sessionString: string): Promise<{
  id: string;
  username?: string;
  firstName?: string;
  phone?: string;
}> {
  // ✅ ИСПРАВЛЕНО: StringSession принимает строку сессии
  const session = new StringSession(sessionString);
  
  const client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  try {
    await client.connect();
    const me = await client.getMe() as any;
    
    return {
      id: me.id?.toString() || '',
      username: me.username,
      firstName: me.firstName,
      phone: me.phone,
    };
  } finally {
    await client.disconnect();
  }
}