import { Bot, Context, webhookCallback, InlineKeyboard } from 'grammy/web';
import { Database } from './db';
import type { Env, ExpenseSession } from './types';

// Import handlers
import {
  handleRegister,
  handleSetAccount,
  handleAccountInfo,
  handleViewAccount,
  handleListUsers,
  handleUnregister,
  handleGroupAccountInfo
} from './handlers/registration';

import {
  handleAddExpense,
  handleExpenseAmount,
  handleExpenseDescription,
  handleExpenseLocation,
  handleExpensePhoto,
  handleVendorSlipPhoto,
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
  handlePay,
  handlePayCallback,
  handleConfirmPay,
  handleCancelPay,
  handleViewOwed,
  handlePayPhoto,
  handlePaySkip,
  handleAdminPay,
  handleAdminPayCallback
} from './handlers/payments';

import {
  sendReminders,
  handleSetReminder,
  handleReminderStatus,
  handleSetTimezone,
  handleTimezoneInfo,
  handleViewTimezone
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

      // Middleware: Auto-register users on any message in group chats
      bot.use(async (ctx, next) => {
        if (ctx.chat?.type !== 'private' && ctx.from && !ctx.from.is_bot) {
          const isRegistered = await db.isUserInGroup(ctx.chat.id, ctx.from.id);
          if (!isRegistered) {
            // Create user if doesn't exist
            await db.createUser({
              telegram_id: ctx.from.id,
              username: ctx.from.username,
              first_name: ctx.from.first_name,
              last_name: ctx.from.last_name
            });
            // Register user in group (registered_by is themselves for auto-registration)
            await db.registerUserInGroup(ctx.chat.id, ctx.from.id, ctx.from.id);
          }
        }
        await next();
      });

      // Command handlers
      bot.command('start', async (ctx) => {
        await ctx.reply(
          'Welcome to RasWise Redux!\n\n' +
          'I help you split expenses with your friends.\n\n' +
          'Available commands:\n' +
          '/register - Register a user in a group\n' +
          '/unregister - Unregister a user (admin)\n' +
          '/listusers - List registered users\n' +
          '/setaccount - Set your bank account (DM)\n' +
          '/viewaccount - View your bank account (DM)\n' +
          '/accountinfo - View all users\' bank accounts\n' +
          '/addexpense - Add a new expense\n' +
          '/myexpenses - View your pending expenses\n' +
          '/summary - View your expense summary\n' +
          '/history - View group expense history\n' +
          '/pay - Mark an expense as paid\n' +
          '/adminpay - Mark payment on behalf of user (admin)\n' +
          '/owed - See who owes you money\n' +
          '/setreminder - Toggle daily reminders\n' +
          '/settimezone - Set group timezone (admin)\n' +
          '/viewtimezone - View current timezone\n' +
          '/help - Show this help message'
        );
      });

      bot.command('help', async (ctx) => {
        await ctx.reply(
          '*RasWise Redux Help*\n\n' +
          '*User Management:*\n' +
          '/listusers - See all registered users in this group\n' +
          '/register - Manually register a user (reply to their message)\n' +
          '/unregister - Unregister a user from the group (admin)\n' +
          '/setaccount - Set/update your bank account (DM)\n' +
          '/viewaccount - View your bank account (DM)\n' +
          '/accountinfo - View all users\' bank accounts\n' +
          '*Note:* Users are auto-registered on first message\n\n' +
          '*Expense Management:*\n' +
          '/addexpense - Add a new expense to split\n' +
          '/myexpenses - See your pending expenses (DM)\n' +
          '/summary - See your expense summary (DM)\n' +
          '/history - See group expense history (DM)\n\n' +
          '*Payments:*\n' +
          '/pay - Mark an expense as paid\n' +
          '/adminpay - Mark payment on behalf of user (admin)\n' +
          '/owed - See who owes you money (DM)\n\n' +
          '*Reminders:*\n' +
          '/setreminder - Enable/disable daily reminders (admin)\n' +
          '/reminderstatus - Check reminder status\n\n' +
          '*Timezone:*\n' +
          '/settimezone - Set group timezone (admin)\n' +
          '/viewtimezone - View current timezone\n\n' +
          'Group commands work in group chats.\n' +
          'Personal info is sent via DM for privacy!',
          { parse_mode: 'Markdown' }
        );
      });

      bot.command('register', (ctx) => handleRegister(ctx, db));
      bot.command('unregister', (ctx) => handleUnregister(ctx, db));
      bot.command('listusers', (ctx) => handleListUsers(ctx, db));
      bot.command('setaccount', (ctx) => handleSetAccount(ctx, db, env.KV));
      bot.command('viewaccount', (ctx) => handleViewAccount(ctx, db));
      bot.command('accountinfo', (ctx) => handleGroupAccountInfo(ctx, db));

      bot.command('addexpense', (ctx) => handleAddExpense(ctx, db, env.KV));
      bot.command('myexpenses', (ctx) => handleMyExpenses(ctx, db, env.R2_PUBLIC_URL));
      bot.command('summary', (ctx) => handleSummary(ctx, db));
      bot.command('history', (ctx) => handleHistory(ctx, db, env.R2_PUBLIC_URL));

      bot.command('pay', (ctx) => handlePay(ctx, db));
      bot.command('adminpay', (ctx) => handleAdminPay(ctx, db));
      bot.command('owed', (ctx) => handleViewOwed(ctx, db));

      bot.command('setreminder', (ctx) => handleSetReminder(ctx, db));
      bot.command('reminderstatus', (ctx) => handleReminderStatus(ctx, db));
      bot.command('settimezone', (ctx) => handleSetTimezone(ctx, db, env.KV));
      bot.command('viewtimezone', (ctx) => handleViewTimezone(ctx, db));

      // Callback query handlers - now using sessions to get group_id
      bot.callbackQuery(/^expense_user:(.+)$/, async (ctx) => {
        const targetUserId = ctx.match![1];
        const currentUserId = ctx.from!.id;

        // Get session to find group_id
        const sessionData = await env.KV.get(`expense_session:${currentUserId}`);
        if (!sessionData) {
          return ctx.answerCallbackQuery({ text: 'Session expired' });
        }
        const session: ExpenseSession = JSON.parse(sessionData);

        await handleUserSelection(ctx, db, env.KV, parseInt(targetUserId), targetUserId, session.group_id!, currentUserId);
      });

      bot.callbackQuery('expense_users_done', async (ctx) => {
        const currentUserId = ctx.from!.id;

        // Get session to find group_id
        const sessionData = await env.KV.get(`expense_session:${currentUserId}`);
        if (!sessionData) {
          return ctx.answerCallbackQuery({ text: 'Session expired' });
        }
        const session: ExpenseSession = JSON.parse(sessionData);

        await handleUsersDone(ctx, db, env.KV, session.group_id!, currentUserId);
      });

      bot.callbackQuery(/^expense_paidby:(.+)$/, async (ctx) => {
        const paidById = parseInt(ctx.match![1]);
        const currentUserId = ctx.from!.id;

        // Get session to find group_id
        const sessionData = await env.KV.get(`expense_session:${currentUserId}`);
        if (!sessionData) {
          return ctx.answerCallbackQuery({ text: 'Session expired' });
        }
        const session: ExpenseSession = JSON.parse(sessionData);

        await handlePaidBy(ctx, db, env.KV, paidById, session.group_id!, currentUserId);
      });

      bot.callbackQuery(/^expense_split:(.+)$/, async (ctx) => {
        const splitType = ctx.match![1] as 'equal' | 'custom';
        const currentUserId = ctx.from!.id;

        // Get session to find group_id
        const sessionData = await env.KV.get(`expense_session:${currentUserId}`);
        if (!sessionData) {
          return ctx.answerCallbackQuery({ text: 'Session expired' });
        }
        const session: ExpenseSession = JSON.parse(sessionData);

        await handleSplitType(ctx, db, env.KV, env.BILLS_BUCKET, splitType, session.group_id!, currentUserId, env.R2_PUBLIC_URL);
      });

      bot.callbackQuery(/^expense_skip:(.+)$/, async (ctx) => {
        const field = ctx.match![1];
        const currentUserId = ctx.from!.id;

        // Get session to find group_id
        const sessionData = await env.KV.get(`expense_session:${currentUserId}`);
        if (!sessionData) {
          return ctx.answerCallbackQuery({ text: 'Session expired' });
        }
        const session: ExpenseSession = JSON.parse(sessionData);

        await handleSkip(ctx, db, env.KV, env.BILLS_BUCKET, field, session.group_id!, currentUserId);
      });

      bot.callbackQuery(/^pay:(.+)$/, async (ctx) => {
        const splitId = parseInt(ctx.match![1]);
        await handlePayCallback(ctx, db, splitId);
      });

      bot.callbackQuery(/^adminpay:(\d+):(\d+)$/, async (ctx) => {
        const splitId = parseInt(ctx.match![1]);
        const targetUserId = parseInt(ctx.match![2]);
        await handleAdminPayCallback(ctx, db, splitId, targetUserId);
      });

      bot.callbackQuery(/^confirm_pay:(.+)$/, async (ctx) => {
        const splitId = parseInt(ctx.match![1]);
        await handleConfirmPay(ctx, db, env.KV, splitId);
      });

      bot.callbackQuery(/^pay_skip:(.+)$/, async (ctx) => {
        const splitId = parseInt(ctx.match![1]);
        await handlePaySkip(ctx, db, env.KV, splitId);
      });

      bot.callbackQuery('cancel_pay', (ctx) => handleCancelPay(ctx));

      // Message handlers for expense session flow
      bot.on('message:text', async (ctx) => {
        const userId = ctx.from!.id;
        const chatId = ctx.chat!.id;

        // Check for timezone session
        const timezoneSessionKey = `timezone_session:${chatId}:${userId}`;
        const timezoneSessionData = await env.KV.get(timezoneSessionKey);

        if (timezoneSessionData) {
          const session = JSON.parse(timezoneSessionData);
          await handleTimezoneInfo(ctx, db, env.KV, session, chatId, userId);
          return;
        }

        // Check for account session
        const accountSessionKey = `account_session:${userId}`;
        const accountSessionData = await env.KV.get(accountSessionKey);

        if (accountSessionData) {
          await handleAccountInfo(ctx, db, env.KV);
          return;
        }

        // Check for expense session (DM-based)
        const expenseSessionKey = `expense_session:${userId}`;
        const expenseSessionData = await env.KV.get(expenseSessionKey);

        if (expenseSessionData) {
          const session: ExpenseSession = JSON.parse(expenseSessionData);

          // Use the stored group_id from session
          const groupId = session.group_id!;

          if (session.step === 'amount') {
            await handleExpenseAmount(ctx, db, env.KV, session, groupId, userId);
          } else if (session.step === 'description') {
            await handleExpenseDescription(ctx, db, env.KV, session, groupId, userId);
          } else if (session.step === 'location') {
            await handleExpenseLocation(ctx, db, env.KV, session, groupId, userId);
          } else if (session.step === 'custom_splits') {
            await handleCustomSplit(ctx, db, env.KV, env.BILLS_BUCKET, session, groupId, userId, env.R2_PUBLIC_URL);
          }
          return;
        }
      });

      // Photo handler for expense photos and payment slips
      bot.on('message:photo', async (ctx) => {
        const userId = ctx.from!.id;

        // Check for pay session first
        const paySessionData = await env.KV.get(`pay_session:${userId}`);
        if (paySessionData) {
          await handlePayPhoto(ctx, db, env.KV, env.BILLS_BUCKET, userId);
          return;
        }

        const expenseSessionKey = `expense_session:${userId}`;
        const expenseSessionData = await env.KV.get(expenseSessionKey);

        if (expenseSessionData) {
          const session: ExpenseSession = JSON.parse(expenseSessionData);
          const groupId = session.group_id!;

          if (session.step === 'photo') {
            await handleExpensePhoto(ctx, db, env.KV, env.BILLS_BUCKET, session, groupId, userId);
          } else if (session.step === 'vendor_slip') {
            await handleVendorSlipPhoto(ctx, db, env.KV, env.BILLS_BUCKET, session, groupId, userId);
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
