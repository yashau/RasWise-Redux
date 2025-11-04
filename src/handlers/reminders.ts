import { Context } from 'grammy/web';
import { Database } from '../db';
import { formatDateTime, formatAmount, saveSession, getSession } from '../utils';

export async function sendReminders(db: Database, botToken: string) {
  // Get all groups that have unpaid expenses
  const groupIds = await db.getGroupsForReminder();

  for (const groupId of groupIds) {
    try {
      // Get reminder settings
      const settings = await db.getReminderSettings(groupId);

      // Skip if reminders are disabled
      if (settings && settings.enabled === 0) {
        continue;
      }

      // Check if reminder was already sent today
      const now = Date.now();
      const today = new Date(now).toDateString();

      if (settings?.last_reminder_sent) {
        const lastSent = new Date(settings.last_reminder_sent).toDateString();
        if (lastSent === today) {
          continue; // Already sent today
        }
      }

      // Get all users with unpaid expenses in this group
      const groupUsers = await db.getGroupUsers(groupId);

      for (const user of groupUsers) {
        const unpaidSplits = await db.getUserUnpaidSplits(user.telegram_id, groupId);

        if (unpaidSplits.length === 0) continue;

        const totalOwed = unpaidSplits.reduce((sum, s) => sum + s.amount_owed, 0);

        const message =
          `🔔 Daily Reminder\n\n` +
          `You have ${unpaidSplits.length} pending expense${unpaidSplits.length > 1 ? 's' : ''}\n` +
          `Total owed: ${formatAmount(totalOwed)}\n\n` +
          `Use /myexpenses to see details\n` +
          `Use /markpaid to mark as paid`;

        // Send reminder via DM
        try {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: user.telegram_id,
              text: message
            })
          });
        } catch (error) {
          // User hasn't started the bot, skip
          console.error(`Failed to send reminder to user ${user.telegram_id}:`, error);
        }
      }

      // Update last reminder sent
      await db.updateLastReminderSent(groupId);

    } catch (error) {
      console.error(`Failed to process reminders for group ${groupId}:`, error);
    }
  }
}

export async function handleSetReminder(ctx: Context, db: Database) {
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('This command can only be used in group chats.');
  }

  const groupId = ctx.chat.id;

  // Toggle reminder settings
  const currentSettings = await db.getReminderSettings(groupId);

  if (currentSettings && currentSettings.enabled === 1) {
    await db.setReminderSettings(groupId, false, currentSettings.reminder_time || '10:00');
    await ctx.reply('🔕 Daily reminders have been disabled for this group.');
  } else {
    await db.setReminderSettings(groupId, true, currentSettings?.reminder_time || '10:00');
    await ctx.reply(
      '🔔 Daily reminders have been enabled for this group!\n\n' +
      'Users with pending expenses will receive a daily DM reminder.'
    );
  }
}

export async function handleReminderStatus(ctx: Context, db: Database) {
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('This command can only be used in group chats.');
  }

  const groupId = ctx.chat.id;
  const settings = await db.getReminderSettings(groupId);
  const timezoneOffset = await db.getGroupTimezone(groupId);

  if (!settings || settings.enabled === 0) {
    await ctx.reply(
      '🔕 Daily reminders are currently disabled.\n\n' +
      'Use /setreminder to enable them.'
    );
  } else {
    const lastSent = settings.last_reminder_sent
      ? formatDateTime(settings.last_reminder_sent, timezoneOffset)
      : 'Never';

    await ctx.reply(
      '🔔 Daily reminders are enabled\n\n' +
      `Last sent: ${lastSent}\n\n` +
      'Use /setreminder to disable'
    );
  }
}

export async function handleSetTimezone(ctx: Context, db: Database, kv: KVNamespace) {
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('This command can only be used in group chats.');
  }

  // Check if user is admin
  const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from!.id);
  if (member.status !== 'creator' && member.status !== 'administrator') {
    return ctx.reply('❌ Only group admins can set the timezone.');
  }

  const groupId = ctx.chat.id;
  const userId = ctx.from!.id;

  // Start session
  const session = {
    group_id: groupId,
    step: 'timezone_offset'
  };

  const sessionKey = `timezone_session:${groupId}:${userId}`;
  await saveSession(kv, sessionKey, session);

  await ctx.reply(
    '🌍 Set Group Timezone\n\n' +
    'Please enter the timezone offset from UTC.\n\n' +
    'Examples:\n' +
    '+5 for Maldives\n' +
    '-5 for Eastern US\n' +
    '+0 for UTC\n' +
    '+8 for Singapore\n\n' +
    'Just send the number (like +5 or -5)'
  );
}

export async function handleTimezoneInfo(ctx: Context, db: Database, kv: KVNamespace, session: any, groupId: number, userId: number) {
  const text = ctx.message?.text;

  if (!text) {
    return ctx.reply('❌ Please send a valid timezone offset (e.g., +5.5 or -5)');
  }

  // Parse timezone offset
  const offset = parseFloat(text);

  if (isNaN(offset) || offset < -12 || offset > 14) {
    return ctx.reply(
      '❌ Invalid timezone offset. Please enter a number between -12 and +14\n\n' +
      'Examples: +5.5, -5, +8, +0'
    );
  }

  // Save timezone
  await db.setGroupTimezone(groupId, offset);

  // Clear session
  const sessionKey = `timezone_session:${groupId}:${userId}`;
  await kv.delete(sessionKey);

  const sign = offset >= 0 ? '+' : '';
  await ctx.reply(
    `✅ Timezone set to UTC${sign}${offset}\n\n` +
    'All dates in this group will now be displayed in this timezone.'
  );
}

export async function handleViewTimezone(ctx: Context, db: Database) {
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('This command can only be used in group chats.');
  }

  const groupId = ctx.chat.id;
  const offset = await db.getGroupTimezone(groupId);

  const sign = offset >= 0 ? '+' : '';
  await ctx.reply(
    `🌍 Current Group Timezone: UTC${sign}${offset}\n\n` +
    'To change the timezone, use /settimezone (admin only)'
  );
}
