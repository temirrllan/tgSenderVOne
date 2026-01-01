// backend/src/services/ton-payment-simple.service.ts
// Упрощенная версия через REST API (без @ton/ton библиотеки)

import axios from 'axios';
import { User } from '../models/User.js';
import { TxHistory } from '../models/TxHistory.js';
import { Types } from 'mongoose';

const WALLET_ADDRESS = process.env.TON_WALLET_ADDRESS || '';
const TONCENTER_API_KEY = process.env.TON_API_KEY || '';
const TONCENTER_URL = 'https://toncenter.com/api/v2';

interface SimpleTx {
  hash: string;
  from: string;
  to: string;
  value: string; // в nanotons
  comment: string;
  timestamp: number;
}

/**
 * Конвертация nanotons в TON
 */
function nanotonToTon(nanoton: string): number {
  return Number(nanoton) / 1_000_000_000;
}

/**
 * Конвертация TON в USD (через CoinGecko API)
 */
async function getTonUsdRate(): Promise<number> {
  try {
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price',
      {
        params: {
          ids: 'the-open-network',
          vs_currencies: 'usd',
        },
      }
    );
    
    return response.data['the-open-network']?.usd || 2.4;
  } catch (error) {
    console.error('Failed to get TON rate, using fallback:', error);
    return 2.4; // Fallback курс
  }
}

async function tonToUsd(ton: number): Promise<number> {
  const rate = await getTonUsdRate();
  return ton * rate;
}

/**
 * Получить последние транзакции через TONCenter API
 */
export async function getWalletTransactions(
  limit: number = 10
): Promise<SimpleTx[]> {
  try {
    const response = await axios.get(`${TONCENTER_URL}/getTransactions`, {
      params: {
        address: WALLET_ADDRESS,
        limit,
        archival: false,
      },
      headers: {
        'X-API-Key': TONCENTER_API_KEY,
      },
    });

    if (!response.data?.ok || !response.data?.result) {
      throw new Error('Invalid API response');
    }

    const transactions: SimpleTx[] = [];

    for (const tx of response.data.result) {
      // Только входящие транзакции
      if (!tx.in_msg || tx.in_msg.source === '') continue;

      // Извлекаем комментарий из message
      let comment = '';
      try {
        if (tx.in_msg.message) {
          // Декодируем base64 если нужно
          const msg = tx.in_msg.message;
          if (typeof msg === 'string') {
            // Пробуем распарсить как base64
            try {
              comment = Buffer.from(msg, 'base64').toString('utf-8');
              // Убираем non-printable символы
              comment = comment.replace(/[^\x20-\x7E]/g, '').trim();
            } catch {
              comment = msg;
            }
          }
        }
      } catch (e) {
        console.error('Failed to parse comment:', e);
      }

      transactions.push({
        hash: tx.transaction_id?.hash || '',
        from: tx.in_msg.source || '',
        to: tx.in_msg.destination || WALLET_ADDRESS,
        value: tx.in_msg.value || '0',
        comment,
        timestamp: tx.utime || 0,
      });
    }

    return transactions;
  } catch (error) {
    console.error('❌ Failed to get transactions:', error);
    throw new Error('Failed to fetch wallet transactions');
  }
}

/**
 * Проверить конкретную транзакцию по memo-ключу
 */
export async function checkPaymentByMemo(memo: string): Promise<{
  found: boolean;
  amount?: number; // в USD
  tonAmount?: number;
  txHash?: string;
  timestamp?: number;
}> {
  try {
    const transactions = await getWalletTransactions(100);
    
    const found = transactions.find(tx => {
      const cleanMemo = memo.trim().toLowerCase();
      const cleanComment = tx.comment.trim().toLowerCase();
      
      // Проверяем точное совпадение или вхождение
      return cleanComment === cleanMemo || cleanComment.includes(cleanMemo);
    });

    if (!found) {
      return { found: false };
    }

    const tonAmount = nanotonToTon(found.value);
    const usdAmount = await tonToUsd(tonAmount);

    return {
      found: true,
      amount: usdAmount,
      tonAmount,
      txHash: found.hash,
      timestamp: found.timestamp,
    };
  } catch (error) {
    console.error('❌ Failed to check payment:', error);
    throw new Error('Failed to check payment');
  }
}

/**
 * Обработать платеж и начислить баланс
 */
export async function processPayment(
  userId: Types.ObjectId,
  memo: string
): Promise<{
  success: boolean;
  message: string;
  balance?: number;
  amount?: number;
}> {
  try {
    // 1. Проверяем транзакцию в блокчейне
    const payment = await checkPaymentByMemo(memo);

    if (!payment.found) {
      return {
        success: false,
        message: 'Платеж не найден. Попробуйте позже (обработка до 10 минут)',
      };
    }

    // 2. Проверяем что транзакция не была обработана ранее
    const existingTx = await TxHistory.findOne({
      code12: memo,
      status: 'confirmed',
    });

    if (existingTx) {
      return {
        success: false,
        message: 'Этот платеж уже был обработан',
      };
    }

    // 3. Находим или создаем запись транзакции
    let tx = await TxHistory.findOne({ code12: memo });
    
    const txAmount = payment.amount ?? 0;
    const txHash = payment.txHash ?? '';
    
    if (!tx) {
      tx = await TxHistory.create({
        user: userId,
        type: 'OTHER',
        status: 'pending',
        amount: txAmount,
        currency: 'USD',
        wallet: WALLET_ADDRESS,
        code12: memo,
        txHash,
        meta: {
          tonAmount: payment.tonAmount,
          timestamp: payment.timestamp,
        },
      });
    }

    // 4. Подтверждаем транзакцию
    tx.status = 'confirmed';
    tx.txHash = txHash;
    tx.confirmedAt = new Date();
    await tx.save();

    // 5. Начисляем баланс пользователю
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    user.balance += txAmount;
    await user.save();

    console.log(`✅ Payment processed: ${memo}, amount: $${txAmount}, user: ${user.tgId}`);

    return {
      success: true,
      message: `Платеж подтвержден! Начислено $${txAmount.toFixed(2)}`,
      balance: user.balance,
      amount: txAmount,
    };
  } catch (error) {
    console.error('❌ Failed to process payment:', error);
    return {
      success: false,
      message: 'Ошибка обработки платежа. Свяжитесь с поддержкой',
    };
  }
}

/**
 * Крон-задача для автоматической обработки платежей
 */
export async function processPendingPayments(): Promise<void> {
  try {
    // Получаем все pending транзакции за последние 24 часа
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const pendingTxs = await TxHistory.find({
      status: 'pending',
      createdAt: { $gte: yesterday },
    });

    console.log(`🔄 Processing ${pendingTxs.length} pending payments...`);

    for (const tx of pendingTxs) {
      try {
        await processPayment(tx.user as Types.ObjectId, tx.code12);
        // Задержка между запросами чтобы не перегружать API
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Failed to process tx ${tx.code12}:`, error);
      }
    }

    console.log('✅ Pending payments processed');
  } catch (error) {
    console.error('❌ Failed to process pending payments:', error);
  }
}