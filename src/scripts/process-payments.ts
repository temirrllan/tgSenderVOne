// backend/src/scripts/process-payments.ts
import cron from 'node-cron';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { processPendingPayments } from '../services/ton-payment.service.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGO_URL || '';

async function setupCronJobs() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    
    await mongoose.connect(MONGO_URI, {
      dbName: 'sendingBot',
    });
    
    console.log('✅ Connected to MongoDB');

    // Запускаем каждые 5 минут
    cron.schedule('*/5 * * * *', async () => {
      console.log('\n⏰ Running payment processing cron job...');
      
      try {
        await processPendingPayments();
        console.log('✅ Cron job completed');
      } catch (error) {
        console.error('❌ Cron job failed:', error);
      }
    });

    console.log('✅ Cron jobs configured');
    console.log('🔄 Processing payments every 5 minutes...');
    
    // Первый запуск сразу
    await processPendingPayments();

  } catch (error) {
    console.error('❌ Setup error:', error);
    process.exit(1);
  }
}

// Запускаем если файл запущен напрямую
if (import.meta.url === `file://${process.argv[1]}`) {
  setupCronJobs().catch(console.error);
}

export { setupCronJobs };