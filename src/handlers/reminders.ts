import { Context } from 'grammy/web';
import { Database } from '../db';

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
          `Total owed: ${totalOwed.toFixed(2)}\n\n` +
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

  if (!settings || settings.enabled === 0) {
    await ctx.reply(
      '🔕 Daily reminders are currently disabled.\n\n' +
      'Use /setreminder to enable them.'
    );
  } else {
    const lastSent = settings.last_reminder_sent
      ? new Date(settings.last_reminder_sent).toLocaleString()
      : 'Never';

    await ctx.reply(
      '🔔 Daily reminders are enabled\n\n' +
      `Last sent: ${lastSent}\n\n` +
      'Use /setreminder to disable'
    );
  }
}
