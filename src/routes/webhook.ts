// backend/src/routes/webhook.ts
import express, { Router, Request, Response } from 'express';
import { processPendingPayments } from '../services/ton-payment.service.js';

const router: Router = express.Router();

/**
 * Webhook для автоматической обработки платежей
 * Вызывается внешним сервисом или крон-задачей
 * 
 * POST /api/webhook/process-payments
 */
router.post('/process-payments', async (_req: Request, res: Response) => {
  try {
    console.log('🔔 Webhook triggered: processing payments...');
    
    await processPendingPayments();
    
    return res.status(200).json({
      success: true,
      message: 'Payments processed successfully',
    });
  } catch (error: any) {
    console.error('❌ Webhook error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to process payments',
    });
  }
});

/**
 * Health check для webhook
 * GET /api/webhook/health
 */
router.get('/health', (_req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    message: 'Webhook is alive',
    timestamp: new Date().toISOString(),
  });
});

export default router;