import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from '../db';
import { sendReminders } from '../handlers/reminders';
import { createTestEnv, cleanupTestEnv } from './setup';
import type { Miniflare } from 'miniflare';
import type { Env } from '../types';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Reminder System', () => {
  let mf: Miniflare;
  let env: Env;
  let db: Database;

  beforeEach(async () => {
    const testEnv = await createTestEnv();
    mf = testEnv.mf;
    env = testEnv.env;
    db = new Database(env.DB);
    mockFetch.mockClear();
  });

  afterEach(async () => {
    await cleanupTestEnv(mf);
    vi.clearAllMocks();
  });

  describe('sendReminders', () => {
    it('should not send reminders when no unpaid expenses exist', async () => {
      await sendReminders(db, env.BOT_TOKEN, env.BOT_USERNAME);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should send reminders to users with unpaid expenses', async () => {
      // Setup: Create users and expenses
      await db.createUser({ telegram_id: 111, first_name: 'User1' });
      await db.createUser({ telegram_id: 222, first_name: 'User2' });
      await db.registerUserInGroup(-100, 111, 111);
      await db.registerUserInGroup(-100, 222, 111);
      await db.addOrUpdateGroupMembership(111, -100, 'Test Group');
      await db.addOrUpdateGroupMembership(222, -100, 'Test Group');

      // Create expense with unpaid split
      const expense = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        description: 'Test expense',
        split_type: 'equal'
      });
      await db.createExpenseSplit(expense.id, 222, 50);

      // Mock successful API response
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true })
      });

      await sendReminders(db, env.BOT_TOKEN, env.BOT_USERNAME);

      // Should send reminder to user 222 who owes money
      expect(mockFetch).toHaveBeenCalled();
      const calls = mockFetch.mock.calls;
      const reminderCall = calls.find((call: any) => {
        const body = JSON.parse(call[1].body);
        return body.chat_id === 222;
      });

      expect(reminderCall).toBeDefined();
      const reminderBody = JSON.parse(reminderCall[1].body);
      expect(reminderBody.text).toContain('Daily Reminder');
      expect(reminderBody.text).toContain('pending expense');
      expect(reminderBody.parse_mode).toBe('Markdown');
    });

    it('should skip reminders when disabled', async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });
      await db.createUser({ telegram_id: 222, first_name: 'User2' });
      await db.registerUserInGroup(-100, 111, 111);
      await db.registerUserInGroup(-100, 222, 111);
      await db.addOrUpdateGroupMembership(222, -100, 'Test Group');

      const expense = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        split_type: 'equal'
      });
      await db.createExpenseSplit(expense.id, 222, 50);

      // Disable reminders for this group
      await db.setReminderSettings(-100, false, '10:00');

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true })
      });

      await sendReminders(db, env.BOT_TOKEN, env.BOT_USERNAME);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not send reminders twice on the same day', async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });
      await db.createUser({ telegram_id: 222, first_name: 'User2' });
      await db.registerUserInGroup(-100, 111, 111);
      await db.registerUserInGroup(-100, 222, 111);
      await db.addOrUpdateGroupMembership(222, -100, 'Test Group');

      const expense = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        split_type: 'equal'
      });
      await db.createExpenseSplit(expense.id, 222, 50);

      // Set reminder as already sent today
      await db.setReminderSettings(-100, true, '10:00');
      await db.updateLastReminderSent(-100);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true })
      });

      await sendReminders(db, env.BOT_TOKEN, env.BOT_USERNAME);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should include total owed amount in reminder', async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });
      await db.createUser({ telegram_id: 222, first_name: 'User2' });
      await db.registerUserInGroup(-100, 111, 111);
      await db.registerUserInGroup(-100, 222, 111);
      await db.addOrUpdateGroupMembership(222, -100, 'Test Group');

      // Create multiple expenses
      const expense1 = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        split_type: 'equal'
      });
      await db.createExpenseSplit(expense1.id, 222, 50);

      const expense2 = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 60,
        split_type: 'equal'
      });
      await db.createExpenseSplit(expense2.id, 222, 30);

      // Set custom currency
      await db.setGroupCurrency(-100, '₹');

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true })
      });

      await sendReminders(db, env.BOT_TOKEN, env.BOT_USERNAME);

      const calls = mockFetch.mock.calls;
      const reminderCall = calls.find((call: any) => {
        const body = JSON.parse(call[1].body);
        return body.chat_id === 222;
      });

      expect(reminderCall).toBeDefined();
      const reminderBody = JSON.parse(reminderCall[1].body);
      expect(reminderBody.text).toContain('2');
      expect(reminderBody.text).toContain('pending expense');
      expect(reminderBody.text).toContain('₹ 80.00'); // Total of 50 + 30
    });

    it('should handle API errors gracefully', async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });
      await db.createUser({ telegram_id: 222, first_name: 'User2' });
      await db.registerUserInGroup(-100, 111, 111);
      await db.registerUserInGroup(-100, 222, 111);
      await db.addOrUpdateGroupMembership(222, -100, 'Test Group');

      const expense = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        split_type: 'equal'
      });
      await db.createExpenseSplit(expense.id, 222, 50);

      // Mock API failure
      mockFetch.mockRejectedValue(new Error('Network error'));

      // Should not throw
      await expect(
        sendReminders(db, env.BOT_TOKEN, env.BOT_USERNAME)
      ).resolves.not.toThrow();
    });

    it('should include deep link to pay page in reminder', async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });
      await db.createUser({ telegram_id: 222, first_name: 'User2' });
      await db.registerUserInGroup(-100, 111, 111);
      await db.registerUserInGroup(-100, 222, 111);
      await db.addOrUpdateGroupMembership(222, -100, 'Test Group');

      const expense = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        split_type: 'equal'
      });
      await db.createExpenseSplit(expense.id, 222, 50);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true })
      });

      await sendReminders(db, env.BOT_TOKEN, env.BOT_USERNAME);

      const calls = mockFetch.mock.calls;
      const reminderCall = calls.find((call: any) => {
        const body = JSON.parse(call[1].body);
        return body.chat_id === 222;
      });

      const reminderBody = JSON.parse(reminderCall[1].body);
      // The underscore in bot username gets escaped for Markdown
      expect(reminderBody.text).toContain(`https://t.me/test\\_bot/app?startapp=pay--100`);
    });

    it('should not send reminders to users with all expenses paid', async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });
      await db.createUser({ telegram_id: 222, first_name: 'User2' });
      await db.registerUserInGroup(-100, 111, 111);
      await db.registerUserInGroup(-100, 222, 111);
      await db.addOrUpdateGroupMembership(222, -100, 'Test Group');

      const expense = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        split_type: 'equal'
      });
      await db.createExpenseSplit(expense.id, 222, 50);

      // Mark as paid
      const splits = await db.getExpenseSplits(expense.id);
      await db.markSplitAsPaid(splits[0].id);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true })
      });

      await sendReminders(db, env.BOT_TOKEN, env.BOT_USERNAME);

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
