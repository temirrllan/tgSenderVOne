// backend/src/services/payment-cron.service.ts
import cron from 'node-cron';
import { processPendingPayments } from './ton-payment.service.js';

/**
 * Настройка крон-задач для автоматической обработки платежей
 * 
 * Запускается каждые 5 минут: */5 * * * *
 * 
 * Можно настроить разные интервалы:
 * - Каждую минуту: * * * * *
 * - Каждые 3 минуты: */3 * * * *
 * - Каждые 10 минут: */10 * * * *
 * - Каждый час: 0 * * * *
 */
export function setupPaymentCron() {
  console.log('⏰ Setting up payment processing cron job...');
  
  // Запускаем каждые 5 минут
  cron.schedule('*/5 * * * *', async () => {
    console.log('\n🔄 [CRON] Running automatic payment processing...');
    
    try {
      await processPendingPayments();
      console.log('✅ [CRON] Payment processing completed\n');
    } catch (error) {
      console.error('❌ [CRON] Payment processing failed:', error);
    }
  });
  
  console.log('✅ Payment cron job configured (runs every 5 minutes)');
  
  // Первый запуск сразу при старте сервера
  console.log('🚀 Running initial payment processing...');
  processPendingPayments().catch(console.error);
}

/**
 * Ручной запуск обработки платежей (для тестирования)
 */
export async function manualProcessPayments(): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    console.log('🔧 Manual payment processing triggered...');
    
    await processPendingPayments();
    
    return {
      success: true,
      message: 'Payments processed successfully',
    };
  } catch (error: any) {
    console.error('❌ Manual processing failed:', error);
    
    return {
      success: false,
      message: error.message || 'Failed to process payments',
    };
  }
}