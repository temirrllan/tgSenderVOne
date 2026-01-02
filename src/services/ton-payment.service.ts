// backend/src/services/ton-payment.service.ts
import axios from 'axios';
import { User } from '../models/User.js';
import { TxHistory } from '../models/TxHistory.js';
import { Types } from 'mongoose';

const WALLET_ADDRESS = process.env.TON_WALLET_ADDRESS || '';
const TONCENTER_API_KEY = process.env.TON_API_KEY || '';
const TONCENTER_URL = 'https://toncenter.com/api/v2';

interface TonTransaction {
  hash: string;
  from: string;
  to: string;
  value: string; // в nanotons
  comment: string;
  timestamp: number;
  utime: number;
}

/**
 * Конвертация nanotons в TON
 */
function nanotonToTon(nanoton: string): number {
  return Number(nanoton) / 1_000_000_000;
}

/**
 * Получить актуальный курс TON/USD через CoinGecko
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
        timeout: 5000,
      }
    );
    
    const rate = response.data['the-open-network']?.usd;
    
    if (!rate || isNaN(rate)) {
      console.warn('⚠️ Invalid TON rate, using fallback');
      return 2.4;
    }
    
    console.log(`💰 TON/USD rate: $${rate}`);
    return rate;
  } catch (error) {
    console.error('❌ Failed to get TON rate:', error);
    return 2.4; // Fallback курс
  }
}

/**
 * Конвертация TON в USD
 */
async function tonToUsd(ton: number): Promise<number> {
  const rate = await getTonUsdRate();
  return ton * rate;
}

/**
 * Получить последние транзакции кошелька через TONCenter API
 */
export async function getWalletTransactions(
  limit: number = 100
): Promise<TonTransaction[]> {
  try {
    console.log(`🔍 Fetching ${limit} transactions for ${WALLET_ADDRESS}`);
    
    const response = await axios.get(`${TONCENTER_URL}/getTransactions`, {
      params: {
        address: WALLET_ADDRESS,
        limit,
        archival: false,
      },
      headers: {
        'X-API-Key': TONCENTER_API_KEY,
      },
      timeout: 10000,
    });

    if (!response.data?.ok || !response.data?.result) {
      throw new Error('Invalid API response');
    }

    const transactions: TonTransaction[] = [];

    for (const tx of response.data.result) {
      // Только входящие транзакции
      if (!tx.in_msg || !tx.in_msg.source || tx.in_msg.source === '') {
        continue;
      }

      // Извлекаем комментарий (memo)
      let comment = '';
      try {
        if (tx.in_msg.message) {
          const msg = tx.in_msg.message;
          
          if (typeof msg === 'string') {
            // Декодируем base64
            try {
              const decoded = Buffer.from(msg, 'base64').toString('utf-8');
              // Убираем non-printable символы
              comment = decoded.replace(/[^\x20-\x7E]/g, '').trim();
            } catch {
              comment = msg.trim();
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
        utime: tx.utime || 0,
      });
    }

    console.log(`✅ Found ${transactions.length} incoming transactions`);
    return transactions;
  } catch (error: any) {
    console.error('❌ Failed to get transactions:', error.message);
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
    console.log(`🔎 Checking payment with memo: ${memo}`);
    
    const transactions = await getWalletTransactions(100);
    
    const found = transactions.find(tx => {
      const cleanMemo = memo.trim().toLowerCase();
      const cleanComment = tx.comment.trim().toLowerCase();
      
      // Проверяем точное совпадение или вхождение
      return cleanComment === cleanMemo || cleanComment.includes(cleanMemo);
    });

    if (!found) {
      console.log(`❌ Payment not found for memo: ${memo}`);
      return { found: false };
    }

    const tonAmount = nanotonToTon(found.value);
    const usdAmount = await tonToUsd(tonAmount);

    console.log(`✅ Payment found:`, {
      memo,
      tonAmount: `${tonAmount} TON`,
      usdAmount: `$${usdAmount.toFixed(2)}`,
      txHash: found.hash,
    });

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
    console.log(`💳 Processing payment for user ${userId}, memo: ${memo}`);
    
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
      console.log(`⚠️ Payment already processed: ${memo}`);
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
          type: 'balance_topup',
        },
      });
    }

    // 4. Подтверждаем транзакцию
    tx.status = 'confirmed';
    tx.txHash = txHash;
    tx.amount = txAmount; // Обновляем сумму из реальной транзакции
    tx.confirmedAt = new Date();
    await tx.save();

    // 5. Начисляем баланс пользователю
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    user.balance += txAmount;
    await user.save();

    console.log(`✅ Payment processed successfully:`, {
      memo,
      amount: `$${txAmount.toFixed(2)}`,
      user: user.tgId,
      newBalance: `$${user.balance}`,
    });

    return {
      success: true,
      message: `Платеж подтвержден! Начислено $${txAmount.toFixed(2)}`,
      balance: user.balance,
      amount: txAmount,
    };
  } catch (error: any) {
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
    console.log('\n⏰ Starting automatic payment processing...');
    
    // Получаем все pending транзакции за последние 24 часа
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const pendingTxs = await TxHistory.find({
      status: 'pending',
      createdAt: { $gte: yesterday },
    });

    console.log(`📋 Found ${pendingTxs.length} pending payments`);

    if (pendingTxs.length === 0) {
      console.log('✅ No pending payments to process');
      return;
    }

    let processed = 0;
    let failed = 0;

    for (const tx of pendingTxs) {
      try {
        const result = await processPayment(tx.user as Types.ObjectId, tx.code12);
        
        if (result.success) {
          processed++;
          console.log(`✅ Processed: ${tx.code12}`);
        } else {
          console.log(`⏳ Still pending: ${tx.code12}`);
        }
        
        // Задержка между запросами чтобы не перегружать API
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        failed++;
        console.error(`❌ Failed to process tx ${tx.code12}:`, error);
      }
    }

    console.log(`\n📊 Payment processing summary:`);
    console.log(`   Processed: ${processed}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Still pending: ${pendingTxs.length - processed - failed}`);
    console.log('✅ Automatic payment processing completed\n');
  } catch (error) {
    console.error('❌ Failed to process pending payments:', error);
  }
}