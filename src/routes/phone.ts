// backend/src/routes/phone.ts
import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { PhoneNumber } from '../models/PhoneNumber.js';
import { User } from '../models/User.js';
import { 
  searchAvailableNumbers, 
  purchaseNumber, 
  getOwnedNumbers,
  releaseNumber 
} from '../services/twilio.service.js';
import { 
  checkPaymentByMemo, 
  processPayment 
} from '../services/ton-payment.service.js';

const router = express.Router();

function success(res: any, data: any, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res: any, status = 400, message = "error") {
  return res.status(status).json({ success: false, error: message });
}

// ============================================
// PHONE NUMBERS
// ============================================

/**
 * GET /api/phone/search
 * Поиск доступных номеров для покупки
 */
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { countryCode = 'US', areaCode } = req.query;
    
    const numbers = await searchAvailableNumbers(
      countryCode as string,
      areaCode as string | undefined
    );

    return success(res, { numbers });
  } catch (err) {
    console.error('GET /api/phone/search error:', err);
    return fail(res, 500, 'Failed to search numbers');
  }
});

/**
 * POST /api/phone/purchase
 * Покупка номера
 * Body: { phoneNumber: string }
 */
router.post('/purchase', authMiddleware, express.json(), async (req, res) => {
  try {
    const user = res.locals.user;
    if (!user) return fail(res, 401, 'user_not_found');

    const { phoneNumber } = req.body;
    if (!phoneNumber) return fail(res, 400, 'phoneNumber required');

    // Проверяем баланс (стоимость номера $1/месяц)
    const PHONE_PRICE = 1;
    
    if (user.balance < PHONE_PRICE) {
      return fail(res, 402, 'insufficient_funds');
    }

    // Покупаем номер через Twilio
    const purchased = await purchaseNumber(phoneNumber, user.tgId.toString());

    // Списываем деньги
    user.balance -= PHONE_PRICE;
    await user.save();

    // Сохраняем в БД
    const nextBilling = new Date();
    nextBilling.setMonth(nextBilling.getMonth() + 1);

    const phoneDoc = await PhoneNumber.create({
      owner: user._id,
      phoneNumber: purchased.phoneNumber,
      friendlyName: purchased.friendlyName,
      twilioSid: purchased.sid,
      smsEnabled: purchased.capabilities.sms,
      voiceEnabled: purchased.capabilities.voice,
      mmsEnabled: purchased.capabilities.mms,
      status: 'active',
      monthlyPrice: PHONE_PRICE,
      currency: 'USD',
      purchasedAt: new Date(),
      nextBillingDate: nextBilling,
      totalSpent: PHONE_PRICE,
    });

    console.log(`✅ User ${user.tgId} purchased phone: ${phoneNumber}`);

    return success(res, { 
      phone: phoneDoc,
      newBalance: user.balance 
    }, 201);
  } catch (err) {
    console.error('POST /api/phone/purchase error:', err);
    return fail(res, 500, 'Failed to purchase phone number');
  }
});

/**
 * GET /api/phone/my-numbers
 * Получить список своих номеров
 */
router.get('/my-numbers', authMiddleware, async (req, res) => {
  try {
    const user = res.locals.user;
    if (!user) return fail(res, 401, 'user_not_found');

    const numbers = await PhoneNumber.find({ 
      owner: user._id,
      status: 'active' 
    }).sort({ purchasedAt: -1 });

    return success(res, { numbers });
  } catch (err) {
    console.error('GET /api/phone/my-numbers error:', err);
    return fail(res, 500, 'Failed to get numbers');
  }
});

/**
 * POST /api/phone/:id/release
 * Освободить номер
 */
router.post('/:id/release', authMiddleware, async (req, res) => {
  try {
    const user = res.locals.user;
    if (!user) return fail(res, 401, 'user_not_found');

    const phone = await PhoneNumber.findOne({
      _id: req.params.id,
      owner: user._id,
    });

    if (!phone) return fail(res, 404, 'phone_not_found');

    // Освобождаем в Twilio
    await releaseNumber(phone.twilioSid);

    // Обновляем статус
    phone.status = 'released';
    await phone.save();

    return success(res, { phone });
  } catch (err) {
    console.error('POST /api/phone/:id/release error:', err);
    return fail(res, 500, 'Failed to release number');
  }
});

// ============================================
// TON PAYMENTS
// ============================================

/**
 * POST /api/payment/create-topup
 * Создать запрос на пополнение баланса
 */
router.post('/payment/create-topup', authMiddleware, express.json(), async (req, res) => {
  try {
    const user = res.locals.user;
    if (!user) return fail(res, 401, 'user_not_found');

    const { amount } = req.body; // Опционально: пользователь может указать сумму
    
    // Генерируем уникальный memo-ключ
    function generateMemo(): string {
      const ts = Date.now().toString(36);
      const rnd = Math.random().toString(36).substring(2, 8);
      return `${ts}-${rnd}`.toUpperCase();
    }

    const memo = generateMemo();
    const walletAddress = process.env.TON_WALLET_ADDRESS || '';

    // Сохраняем транзакцию как pending
    const { TxHistory } = await import('../models/TxHistory.js');
    
    await TxHistory.create({
      user: user._id,
      type: 'OTHER',
      status: 'pending',
      amount: amount || 0, // Сумма будет определена после оплаты
      currency: 'USD',
      wallet: walletAddress,
      code12: memo,
      meta: { type: 'balance_topup' },
    });

    return success(res, {
      walletAddress,
      memo,
      network: 'TON',
      currency: 'USDT',
      message: 'Отправьте любую сумму на указанный адрес с memo-ключом в комментарии',
    });
  } catch (err) {
    console.error('POST /api/payment/create-topup error:', err);
    return fail(res, 500, 'Failed to create topup request');
  }
});

/**
 * POST /api/payment/check
 * Проверить статус платежа по memo
 * Body: { memo: string }
 */
router.post('/payment/check', authMiddleware, express.json(), async (req, res) => {
  try {
    const user = res.locals.user;
    if (!user) return fail(res, 401, 'user_not_found');

    const { memo } = req.body;
    if (!memo) return fail(res, 400, 'memo required');

    // Обрабатываем платеж
    const result = await processPayment(user._id, memo);

    if (result.success) {
      return success(res, {
        confirmed: true,
        amount: result.amount,
        balance: result.balance,
        message: result.message,
      });
    } else {
      return success(res, {
        confirmed: false,
        message: result.message,
      });
    }
  } catch (err) {
    console.error('POST /api/payment/check error:', err);
    return fail(res, 500, 'Failed to check payment');
  }
});

export default router;