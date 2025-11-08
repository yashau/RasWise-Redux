import { Bot, webhookCallback } from 'grammy/web';
import { Database } from './db';
import type { Env } from './types';

// Import only reminder sending for cron jobs
import { sendReminders } from './handlers/reminders';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle scheduled reminders
    if (url.pathname === '/cron/reminders') {
      await sendReminders(new Database(env.DB), env.BOT_TOKEN, env.BOT_USERNAME);
      return new Response('Reminders sent', { status: 200 });
    }

    // Note: Mini App HTML pages are served from public/ directory via assets binding

    // API: Get user's groups for Mini App
    if (url.pathname === '/api/user-groups') {
      const { validateTelegramWebAppData } = await import('./telegram-auth');

      const initData = request.headers.get('X-Telegram-Init-Data') || '';
      const validation = await validateTelegramWebAppData(initData, env.BOT_TOKEN);

      if (!validation.valid) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const userId = validation.user?.id;
      if (!userId) {
        return new Response(JSON.stringify({ error: 'Missing user_id' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const db = new Database(env.DB);
      const groups = await db.getUserGroups(userId);

      return new Response(JSON.stringify({ groups }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // API: Get group users for Mini App
    if (url.pathname === '/api/group-users') {
      const { handleGetGroupUsers } = await import('./api-handlers');
      return handleGetGroupUsers(request, env);
    }

    // API: Get unpaid expenses
    if (url.pathname === '/api/unpaid-expenses') {
      const { handleGetUnpaidExpenses } = await import('./api-handlers');
      return handleGetUnpaidExpenses(request, env);
    }

    // API: Get user expenses
    if (url.pathname === '/api/user-expenses') {
      const { handleGetUserExpenses } = await import('./api-handlers');
      return handleGetUserExpenses(request, env);
    }

    // API: Get summary
    if (url.pathname === '/api/summary') {
      const { handleGetSummary } = await import('./api-handlers');
      return handleGetSummary(request, env);
    }

    // API: Get history
    if (url.pathname === '/api/history') {
      const { handleGetHistory } = await import('./api-handlers');
      return handleGetHistory(request, env);
    }

    // API: Get owed
    if (url.pathname === '/api/owed') {
      const { handleGetOwed } = await import('./api-handlers');
      return handleGetOwed(request, env);
    }

    // API: Add expense
    if (url.pathname === '/api/add-expense' && request.method === 'POST') {
      const { handleAddExpense } = await import('./api-handlers');
      return handleAddExpense(request, env);
    }

    // API: Mark as paid
    if (url.pathname === '/api/mark-paid' && request.method === 'POST') {
      const { handleMarkPaid } = await import('./api-handlers');
      return handleMarkPaid(request, env);
    }

    // API: Delete expense (admin only)
    if (url.pathname === '/api/delete-expense' && request.method === 'POST') {
      const { handleDeleteExpense } = await import('./api-handlers');
      return handleDeleteExpense(request, env);
    }

    // API: Get account info
    if (url.pathname === '/api/account-info') {
      const { handleGetAccountInfo } = await import('./api-handlers');
      return handleGetAccountInfo(request, env);
    }

    // API: Set account info
    if (url.pathname === '/api/set-account' && request.method === 'POST') {
      const { handleSetAccountInfo } = await import('./api-handlers');
      return handleSetAccountInfo(request, env);
    }

    // API: Get group account info
    if (url.pathname === '/api/group-account-info') {
      const { handleGetGroupAccountInfo } = await import('./api-handlers');
      return handleGetGroupAccountInfo(request, env);
    }

    // API: Get group settings
    if (url.pathname === '/api/group-settings') {
      const { handleGetGroupSettings } = await import('./api-handlers');
      return handleGetGroupSettings(request, env);
    }

    // API: Update reminder settings
    if (url.pathname === '/api/update-reminders' && request.method === 'POST') {
      const { handleUpdateReminderSettings } = await import('./api-handlers');
      return handleUpdateReminderSettings(request, env);
    }

    // API: Update timezone
    if (url.pathname === '/api/update-timezone' && request.method === 'POST') {
      const { handleUpdateTimezone } = await import('./api-handlers');
      return handleUpdateTimezone(request, env);
    }

    // API: Update currency
    if (url.pathname === '/api/update-currency' && request.method === 'POST') {
      const { handleUpdateCurrency } = await import('./api-handlers');
      return handleUpdateCurrency(request, env);
    }

    // API: Unregister user (admin only)
    if (url.pathname === '/api/unregister-user' && request.method === 'POST') {
      const { handleUnregisterUser } = await import('./api-handlers');
      return handleUnregisterUser(request, env);
    }

    // API: Get unpaid splits (admin only)
    if (url.pathname === '/api/unpaid-splits') {
      const { handleGetUnpaidSplits } = await import('./api-handlers');
      return handleGetUnpaidSplits(request, env);
    }

    // API: Admin mark paid
    if (url.pathname === '/api/admin-mark-paid' && request.method === 'POST') {
      const { handleAdminMarkPaid } = await import('./api-handlers');
      return handleAdminMarkPaid(request, env);
    }

    // Telegram webhook - minimal bot for auto-registration only
    if (url.pathname === '/webhook') {
      const bot = new Bot(env.BOT_TOKEN);
      const db = new Database(env.DB);

      // Middleware: Track group memberships and auto-register users
      bot.use(async (ctx, next) => {
        if (ctx.chat?.type !== 'private' && ctx.from && !ctx.from.is_bot) {
          // Track group membership
          await db.addOrUpdateGroupMembership(
            ctx.from.id,
            ctx.chat.id,
            ctx.chat.title,
            ctx.chat.username
          );

          // Auto-register users in group_users table
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

      // Handle when users join or leave groups (chat_member updates)
      bot.on('chat_member', async (ctx) => {
        const update = ctx.chatMember;
        const user = update.new_chat_member.user;

        if (user.is_bot) return; // Ignore bot memberships

        // Create user if doesn't exist
        await db.createUser({
          telegram_id: user.id,
          username: user.username,
          first_name: user.first_name,
          last_name: user.last_name
        });

        // Check if user is now a member or left
        const newStatus = update.new_chat_member.status;
        const isMember = ['member', 'administrator', 'creator'].includes(newStatus);

        if (isMember) {
          await db.addOrUpdateGroupMembership(
            user.id,
            ctx.chat.id,
            ctx.chat.title,
            ctx.chat.username
          );
        } else {
          await db.removeGroupMembership(user.id, ctx.chat.id);
        }
      });

      const handleUpdate = webhookCallback(bot, 'cloudflare-mod');
      return await handleUpdate(request);
    }

    return new Response('Not Found', { status: 404 });
  },

  // Scheduled task for daily reminders
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    await sendReminders(new Database(env.DB), env.BOT_TOKEN, env.BOT_USERNAME);
  }
};
