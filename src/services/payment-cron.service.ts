// backend/src/services/payment-cron.service.ts
import cron from 'node-cron';
import { processPendingPayments } from './ton-payment.service.js';

/**
 * Настройка крон-задач для автоматической обработки платежей
 * 
 * Cron expressions:
 * - Every minute: * * * * *
 * - Every 3 minutes: *​/3 * * * *
 * - Every 5 minutes: *​/5 * * * *
 * - Every 10 minutes: *​/10 * * * *
 * - Every hour: 0 * * * *
 * 
 * Default: runs every 5 minutes
 */
export function setupPaymentCron() {
  console.log('⏰ Setting up payment processing cron job...');
  
  // Schedule: every 5 minutes
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
  
  // Initial run on server start
  console.log('🚀 Running initial payment processing...');
  processPendingPayments().catch(console.error);
}

/**
 * Manual payment processing (for testing)
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