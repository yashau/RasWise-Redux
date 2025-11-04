import { Bot, Context, webhookCallback, InlineKeyboard } from 'grammy/web';
import { Database } from './db';
import type { Env, ExpenseSession } from './types';

// Import handlers
import {
  handleRegister,
  handleSetPayment,
  handlePaymentInfo,
  handleViewPayment,
  handleListUsers
} from './handlers/registration';

import {
  handleAddExpense,
  handleExpenseAmount,
  handleExpenseDescription,
  handleExpenseLocation,
  handleExpensePhoto,
  handleUserSelection,
  handleUsersDone,
  handlePaidBy,
  handleSplitType,
  handleCustomSplit,
  handleSkip
} from './handlers/expenses';

import {
  handleMyExpenses,
  handleSummary,
  handleHistory,
  handleExpenseDetail
} from './handlers/history';

import {
  handleMarkPaid,
  handleMarkPaidCallback,
  handleConfirmPaid,
  handleCancelPayment,
  handleViewPayments,
  handlePaymentPhoto,
  handlePaymentSkip
} from './handlers/payments';

import {
  sendReminders,
  handleSetReminder,
  handleReminderStatus
} from './handlers/reminders';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle scheduled reminders
    if (url.pathname === '/cron/reminders') {
      await sendReminders(new Database(env.DB), env.BOT_TOKEN);
      return new Response('Reminders sent', { status: 200 });
    }

    // Telegram webhook
    if (url.pathname === '/webhook') {
      const bot = new Bot(env.BOT_TOKEN);
      const db = new Database(env.DB);

      // Command handlers
      bot.command('start', async (ctx) => {
        await ctx.reply(
          'Welcome to RasWise Redux! 💰\n\n' +
          'I help you split expenses with your friends.\n\n' +
          'Available commands:\n' +
          '/register - Register a user in a group\n' +
          '/listusers - List registered users\n' +
          '/setpayment - Set your payment details\n' +
          '/viewpayment - View your payment details\n' +
          '/addexpense - Add a new expense\n' +
          '/myexpenses - View your pending expenses\n' +
          '/summary - View your expense summary\n' +
          '/history - View group expense history\n' +
          '/markpaid - Mark an expense as paid\n' +
          '/owed - See who owes you money\n' +
          '/setreminder - Toggle daily reminders\n' +
          '/help - Show this help message'
        );
      });

      bot.command('help', async (ctx) => {
        await ctx.reply(
          '📖 RasWise Redux Help\n\n' +
          '👥 User Management:\n' +
          '/register - Reply to a message to register that user\n' +
          '/listusers - See all registered users in this group\n' +
          '/setpayment - Set/update your bank account\n' +
          '/viewpayment - View your saved payment details\n\n' +
          '💰 Expense Management:\n' +
          '/addexpense - Add a new expense to split\n' +
          '/myexpenses - See your pending expenses (DM)\n' +
          '/summary - See your expense summary (DM)\n' +
          '/history - See group expense history (DM)\n\n' +
          '💸 Payments:\n' +
          '/markpaid - Mark an expense as paid\n' +
          '/owed - See who owes you money (DM)\n\n' +
          '🔔 Reminders:\n' +
          '/setreminder - Enable/disable daily reminders\n\n' +
          'Group commands work in group chats.\n' +
          'Personal info is sent via DM for privacy!'
        );
      });

      bot.command('register', (ctx) => handleRegister(ctx, db));
      bot.command('listusers', (ctx) => handleListUsers(ctx, db));
      bot.command('setpayment', (ctx) => handleSetPayment(ctx, db, env.KV));
      bot.command('viewpayment', (ctx) => handleViewPayment(ctx, db));

      bot.command('addexpense', (ctx) => handleAddExpense(ctx, db, env.KV));
      bot.command('myexpenses', (ctx) => handleMyExpenses(ctx, db));
      bot.command('summary', (ctx) => handleSummary(ctx, db));
      bot.command('history', (ctx) => handleHistory(ctx, db));

      bot.command('markpaid', (ctx) => handleMarkPaid(ctx, db));
      bot.command('owed', (ctx) => handleViewPayments(ctx, db));

      bot.command('setreminder', (ctx) => handleSetReminder(ctx, db));
      bot.command('reminderstatus', (ctx) => handleReminderStatus(ctx, db));

      // Callback query handlers
      bot.callbackQuery(/^expense_user:(.+)$/, async (ctx) => {
        const userId = ctx.match![1];
        await handleUserSelection(ctx, db, env.KV, parseInt(userId), userId, ctx.chat!.id, ctx.from!.id);
      });

      bot.callbackQuery('expense_users_done', async (ctx) => {
        await handleUsersDone(ctx, db, env.KV, ctx.chat!.id, ctx.from!.id);
      });

      bot.callbackQuery(/^expense_paidby:(.+)$/, async (ctx) => {
        const paidById = parseInt(ctx.match![1]);
        await handlePaidBy(ctx, db, env.KV, paidById, ctx.chat!.id, ctx.from!.id);
      });

      bot.callbackQuery(/^expense_split:(.+)$/, async (ctx) => {
        const splitType = ctx.match![1] as 'equal' | 'custom';
        await handleSplitType(ctx, db, env.KV, env.BILLS_BUCKET, splitType, ctx.chat!.id, ctx.from!.id);
      });

      bot.callbackQuery(/^expense_skip:(.+)$/, async (ctx) => {
        const field = ctx.match![1];
        await handleSkip(ctx, db, env.KV, env.BILLS_BUCKET, field, ctx.chat!.id, ctx.from!.id);
      });

      bot.callbackQuery(/^markpaid:(.+)$/, async (ctx) => {
        const splitId = parseInt(ctx.match![1]);
        await handleMarkPaidCallback(ctx, db, splitId);
      });

      bot.callbackQuery(/^confirmpaid:(.+)$/, async (ctx) => {
        const splitId = parseInt(ctx.match![1]);
        await handleConfirmPaid(ctx, db, env.KV, splitId);
      });

      bot.callbackQuery(/^payment_skip:(.+)$/, async (ctx) => {
        const splitId = parseInt(ctx.match![1]);
        await handlePaymentSkip(ctx, db, env.KV, splitId);
      });

      bot.callbackQuery('cancel_payment', (ctx) => handleCancelPayment(ctx));

      // Message handlers for expense session flow
      bot.on('message:text', async (ctx) => {
        const userId = ctx.from!.id;
        const chatId = ctx.chat!.id;

        // Check for payment session
        const paymentSessionKey = `payment_session:${userId}`;
        const paymentSessionData = await env.KV.get(paymentSessionKey);

        if (paymentSessionData) {
          await handlePaymentInfo(ctx, db, env.KV);
          return;
        }

        // Check for expense session
        const expenseSessionKey = `expense_session:${chatId}:${userId}`;
        const expenseSessionData = await env.KV.get(expenseSessionKey);

        if (expenseSessionData) {
          const session: ExpenseSession = JSON.parse(expenseSessionData);

          if (session.step === 'amount') {
            await handleExpenseAmount(ctx, db, env.KV, session, chatId, userId);
          } else if (session.step === 'description') {
            await handleExpenseDescription(ctx, db, env.KV, session, chatId, userId);
          } else if (session.step === 'location') {
            await handleExpenseLocation(ctx, db, env.KV, session, chatId, userId);
          } else if (session.step === 'custom_splits') {
            await handleCustomSplit(ctx, db, env.KV, env.BILLS_BUCKET, session, chatId, userId);
          }
          return;
        }
      });

      // Photo handler for expense photos and payment slips
      bot.on('message:photo', async (ctx) => {
        const userId = ctx.from!.id;
        const chatId = ctx.chat!.id;

        // Check for payment session first
        const paymentSessionData = await env.KV.get(`payment_session:${userId}`);
        if (paymentSessionData) {
          await handlePaymentPhoto(ctx, db, env.KV, env.BILLS_BUCKET, userId);
          return;
        }

        const expenseSessionKey = `expense_session:${chatId}:${userId}`;
        const expenseSessionData = await env.KV.get(expenseSessionKey);

        if (expenseSessionData) {
          const session: ExpenseSession = JSON.parse(expenseSessionData);

          if (session.step === 'photo') {
            await handleExpensePhoto(ctx, db, env.KV, env.BILLS_BUCKET, session, chatId, userId);
          }
        }
      });

      const handleUpdate = webhookCallback(bot, 'cloudflare-mod');
      return await handleUpdate(request);
    }

    return new Response('Not Found', { status: 404 });
  },

  // Scheduled task for daily reminders
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    await sendReminders(new Database(env.DB), env.BOT_TOKEN);
  }
};
