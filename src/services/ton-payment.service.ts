// backend/src/services/ton-payment.service.ts
import { TonClient, Address } from '@ton/ton';
import { User } from '../models/User.js';
import { TxHistory } from '../models/TxHistory.js';
import { Types } from 'mongoose';

const WALLET_ADDRESS = process.env.TON_WALLET_ADDRESS || '';
const TON_API_KEY = process.env.TON_API_KEY || '';

// TON API endpoint (можно использовать toncenter.com или tonapi.io)
const client = new TonClient({
  endpoint: 'https://toncenter.com/api/v2/jsonRPC',
  apiKey: TON_API_KEY,
});

interface Transaction {
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
 * Конвертация TON в USD (примерный курс, лучше брать с API)
 */
async function tonToUsd(ton: number): Promise<number> {
  // TODO: Интегрировать с API для получения актуального курса
  // Например: CoinGecko, CoinMarketCap
  const TON_USD_RATE = 2.4; // Примерный курс
  return ton * TON_USD_RATE;
}

/**
 * Получить последние транзакции на кошелек
 */
export async function getWalletTransactions(
  limit: number = 10
): Promise<Transaction[]> {
  try {
    const address = Address.parse(WALLET_ADDRESS);
    const transactions = await client.getTransactions(address, { limit });

    return transactions
      .filter(tx => tx.inMessage?.info.type === 'internal') // Только входящие
      .map(tx => {
        const inMsg = tx.inMessage!;
        const info = inMsg.info;
        
        // Извлекаем комментарий (memo) из body
        let comment = '';
        try {
          const body = inMsg.body;
          if (body && typeof body.beginParse === 'function') {
            const slice = body.beginParse();
            // Пропускаем op code (4 байта)
            if (slice.remainingBits >= 32) {
              slice.loadUint(32);
              // Читаем текст если есть
              if (slice.remainingBits >= 8) {
                comment = slice.loadStringTail();
              }
            }
          }
        } catch (e) {
          console.error('Failed to parse comment:', e);
        }

        // Безопасное получение адреса получателя
        const destAddress = info.type === 'internal' ? info.dest : undefined;
        
        // Безопасное получение суммы
        const value = info.type === 'internal' ? info.value.coins.toString() : '0';

        return {
          hash: tx.hash().toString('hex'),
          from: inMsg.info.src?.toString() || '',
          to: destAddress?.toString() || '',
          value,
          comment,
          timestamp: tx.now,
        };
      });
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
    const transactions = await getWalletTransactions(100); // Последние 100 транзакций
    
    const found = transactions.find(tx => 
      tx.comment.trim() === memo.trim()
    );

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

    const amountToAdd = payment.amount ?? 0;
    user.balance += amountToAdd;
    await user.save();

    console.log(`✅ Payment processed: ${memo}, amount: ${amountToAdd}, user: ${user.tgId}`);

    return {
      success: true,
      message: `Платеж подтвержден! Начислено ${amountToAdd.toFixed(2)}`,
      balance: user.balance,
      amount: amountToAdd,
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
 * Запускается каждые 5 минут
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
      } catch (error) {
        console.error(`Failed to process tx ${tx.code12}:`, error);
      }
    }

    console.log('✅ Pending payments processed');
  } catch (error) {
    console.error('❌ Failed to process pending payments:', error);
  }
}