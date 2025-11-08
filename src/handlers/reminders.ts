import { Database } from '../db';
import { formatAmount, escapeMarkdown } from '../utils';

export async function sendReminders(db: Database, botToken: string, botUsername: string) {
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

      // Get group currency
      const currency = await db.getGroupCurrency(groupId);

      // Get all users with unpaid expenses in this group
      const groupUsers = await db.getGroupUsers(groupId);

      // Get group name from first user's memberships
      let groupName = 'Unknown Group';
      if (groupUsers.length > 0) {
        const memberships = await db.getUserGroups(groupUsers[0].telegram_id);
        const groupInfo = memberships.find(m => m.group_id === groupId);
        groupName = groupInfo?.group_title || `Group ${groupId}`;
      }

      for (const user of groupUsers) {
        const unpaidSplits = await db.getUserUnpaidSplits(user.telegram_id, groupId);

        if (unpaidSplits.length === 0) continue;

        const totalOwed = unpaidSplits.reduce((sum, s) => sum + s.amount_owed, 0);

        const message =
          `💰 *Daily Reminder*\n` +
          `Group: ${escapeMarkdown(groupName)}\n\n` +
          `You have *${unpaidSplits.length}* pending expense${unpaidSplits.length > 1 ? 's' : ''}\n` +
          `Total owed: *${formatAmount(totalOwed, currency)}*\n\n` +
          `👉 Tap to pay: https://t.me/${botUsername.replace(/_/g, '\\_')}/app?startapp=pay-${groupId}`;

        // Send reminder via DM
        try {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: user.telegram_id,
              text: message,
              parse_mode: 'Markdown',
              disable_web_page_preview: false
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
