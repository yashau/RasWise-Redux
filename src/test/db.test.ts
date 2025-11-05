import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../db';
import { createTestEnv, cleanupTestEnv } from './setup';
import type { Miniflare } from 'miniflare';
import type { Env } from '../types';

describe('Database', () => {
  let mf: Miniflare;
  let env: Env;
  let db: Database;

  beforeEach(async () => {
    const testEnv = await createTestEnv();
    mf = testEnv.mf;
    env = testEnv.env;
    db = new Database(env.DB);
  });

  afterEach(async () => {
    await cleanupTestEnv(mf);
  });

  describe('User operations', () => {
    it('should create a user', async () => {
      await db.createUser({
        telegram_id: 123456,
        username: 'testuser',
        first_name: 'Test',
        last_name: 'User'
      });

      const user = await db.getUser(123456);
      expect(user).toBeDefined();
      expect(user?.telegram_id).toBe(123456);
      expect(user?.username).toBe('testuser');
      expect(user?.first_name).toBe('Test');
      expect(user?.last_name).toBe('User');
    });

    it('should return null for non-existent user', async () => {
      const user = await db.getUser(999999);
      expect(user).toBeNull();
    });

    it('should update user on duplicate telegram_id', async () => {
      await db.createUser({
        telegram_id: 123456,
        username: 'testuser',
        first_name: 'Test'
      });

      await db.createUser({
        telegram_id: 123456,
        username: 'updateduser',
        first_name: 'Updated'
      });

      const user = await db.getUser(123456);
      expect(user?.username).toBe('updateduser');
      expect(user?.first_name).toBe('Updated');
    });

    it('should create user without optional fields', async () => {
      await db.createUser({
        telegram_id: 789012
        // No username, first_name, or last_name
      });

      const user = await db.getUser(789012);
      expect(user).toBeDefined();
      expect(user?.telegram_id).toBe(789012);
      expect(user?.username).toBeNull();
      expect(user?.first_name).toBeNull();
      expect(user?.last_name).toBeNull();
    });
  });

  describe('Payment details operations', () => {
    beforeEach(async () => {
      await db.createUser({
        telegram_id: 123456,
        first_name: 'Test'
      });
    });

    it('should add payment details', async () => {
      await db.addPaymentDetail(123456, 'bank', {
        account_number: '1234567890'
      });

      const payment = await db.getActivePaymentDetail(123456);
      expect(payment).toBeDefined();
      expect(payment?.payment_type).toBe('bank');
      const info = JSON.parse(payment!.payment_info);
      expect(info.account_number).toBe('1234567890');
    });

    it('should deactivate old payment details when adding new ones', async () => {
      await db.addPaymentDetail(123456, 'bank', {
        account_number: '1111111111'
      });

      await db.addPaymentDetail(123456, 'bank', {
        account_number: '2222222222'
      });

      const payment = await db.getActivePaymentDetail(123456);
      const info = JSON.parse(payment!.payment_info);
      expect(info.account_number).toBe('2222222222');
    });

    it('should return null for user without payment details', async () => {
      const payment = await db.getActivePaymentDetail(123456);
      expect(payment).toBeNull();
    });
  });

  describe('Group user operations', () => {
    beforeEach(async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });
      await db.createUser({ telegram_id: 222, first_name: 'User2' });
      await db.createUser({ telegram_id: 333, first_name: 'User3' });
    });

    it('should register user in group', async () => {
      await db.registerUserInGroup(-100, 111, 222);

      const isRegistered = await db.isUserInGroup(-100, 111);
      expect(isRegistered).toBe(true);
    });

    it('should get all group users', async () => {
      await db.registerUserInGroup(-100, 111, 222);
      await db.registerUserInGroup(-100, 222, 111);

      const users = await db.getGroupUsers(-100);
      expect(users).toHaveLength(2);
      expect(users.map(u => u.telegram_id)).toContain(111);
      expect(users.map(u => u.telegram_id)).toContain(222);
    });

    it('should not duplicate group user registration', async () => {
      await db.registerUserInGroup(-100, 111, 222);
      await db.registerUserInGroup(-100, 111, 333); // Try to register again

      const users = await db.getGroupUsers(-100);
      expect(users).toHaveLength(1);
    });

    it('should return false for user not in group', async () => {
      const isRegistered = await db.isUserInGroup(-100, 999);
      expect(isRegistered).toBe(false);
    });

    it('should return empty array for group with no users', async () => {
      const users = await db.getGroupUsers(-999);
      expect(users).toEqual([]);
      expect(users).toHaveLength(0);
    });
  });

  describe('Expense operations', () => {
    beforeEach(async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });
      await db.registerUserInGroup(-100, 111, 111);
    });

    it('should create an expense', async () => {
      const result = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100.50,
        description: 'Dinner',
        location: 'Restaurant',
        split_type: 'equal'
      });

      expect(result.id).toBeGreaterThan(0);
      expect(result.group_expense_number).toBe(1);

      const expense = await db.getExpense(result.id);
      expect(expense).toBeDefined();
      expect(expense?.amount).toBe(100.50);
      expect(expense?.description).toBe('Dinner');
      expect(expense?.location).toBe('Restaurant');
      expect(expense?.split_type).toBe('equal');
    });

    it('should get group expenses', async () => {
      await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 50,
        split_type: 'equal'
      });

      await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 75,
        split_type: 'custom'
      });

      const expenses = await db.getGroupExpenses(-100);
      expect(expenses).toHaveLength(2);
    });

    it('should limit group expenses', async () => {
      for (let i = 0; i < 10; i++) {
        await db.createExpense({
          group_id: -100,
          created_by: 111,
        paid_by: 111,
          amount: i * 10,
          split_type: 'equal'
        });
      }

      const expenses = await db.getGroupExpenses(-100, 5);
      expect(expenses).toHaveLength(5);
    });

    it('should return empty array for group with no expenses', async () => {
      const expenses = await db.getGroupExpenses(-999);
      expect(expenses).toEqual([]);
    });
  });

  describe('Expense split operations', () => {
    let expenseId: number;

    beforeEach(async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });
      await db.createUser({ telegram_id: 222, first_name: 'User2' });
      await db.registerUserInGroup(-100, 111, 111);
      await db.registerUserInGroup(-100, 222, 111);

      const result = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        split_type: 'equal'
      });
      expenseId = result.id;
    });

    it('should create expense splits', async () => {
      await db.createExpenseSplit(expenseId, 111, 50);
      await db.createExpenseSplit(expenseId, 222, 50);

      const splits = await db.getExpenseSplits(expenseId);
      expect(splits).toHaveLength(2);
      expect(splits[0].amount_owed).toBe(50);
      expect(splits[1].amount_owed).toBe(50);
    });

    it('should get user unpaid splits', async () => {
      await db.createExpenseSplit(expenseId, 222, 50);

      const unpaidSplits = await db.getUserUnpaidSplits(222);
      expect(unpaidSplits).toHaveLength(1);
      expect(unpaidSplits[0].amount_owed).toBe(50);
      expect(unpaidSplits[0].expense.id).toBe(expenseId);
    });

    it('should mark split as paid', async () => {
      await db.createExpenseSplit(expenseId, 222, 50);
      const splits = await db.getExpenseSplits(expenseId);
      const splitId = splits[0].id;

      await db.markSplitAsPaid(splitId);

      const unpaidSplits = await db.getUserUnpaidSplits(222);
      expect(unpaidSplits).toHaveLength(0);
    });

    it('should return empty array for expense with no splits', async () => {
      const newExpenseResult = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        split_type: 'equal'
      });

      const splits = await db.getExpenseSplits(newExpenseResult.id);
      expect(splits).toEqual([]);
    });

    it('should return empty array for user with no unpaid splits', async () => {
      const unpaidSplits = await db.getUserUnpaidSplits(999);
      expect(unpaidSplits).toEqual([]);
    });
  });

  describe('Payment operations', () => {
    let expenseId: number;
    let splitId: number;

    beforeEach(async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });
      await db.createUser({ telegram_id: 222, first_name: 'User2' });

      const result = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        split_type: 'equal'
      });
      expenseId = result.id;

      await db.createExpenseSplit(expenseId, 222, 50);
      const splits = await db.getExpenseSplits(expenseId);
      splitId = splits[0].id;
    });

    it('should record payment', async () => {
      await db.recordPayment(splitId, 222, 111, 50);
      // Payment recorded successfully - no error thrown
    });

    it('should get user payments', async () => {
      await db.recordPayment(splitId, 222, 111, 50);

      const payments = await db.getUserPayments(222);
      expect(payments).toHaveLength(1);
      expect(payments[0].paid_by).toBe(222);
      expect(payments[0].paid_to).toBe(111);
      expect(payments[0].amount).toBe(50);
      expect(payments[0].expense).toBeDefined();
      expect(payments[0].expense.id).toBe(expenseId);
    });

    it('should get user payments for specific group', async () => {
      await db.recordPayment(splitId, 222, 111, 50);

      // Create another expense in a different group
      const expense2Result = await db.createExpense({
        group_id: -200,
        created_by: 111,
        paid_by: 111,
        amount: 75,
        split_type: 'equal'
      });
      await db.createExpenseSplit(expense2Result.id, 222, 37.5);
      const splits2 = await db.getExpenseSplits(expense2Result.id);
      await db.recordPayment(splits2[0].id, 222, 111, 37.5);

      // Get payments for specific group
      const paymentsGroup1 = await db.getUserPayments(222, -100);
      expect(paymentsGroup1).toHaveLength(1);
      expect(paymentsGroup1[0].expense.group_id).toBe(-100);

      const paymentsGroup2 = await db.getUserPayments(222, -200);
      expect(paymentsGroup2).toHaveLength(1);
      expect(paymentsGroup2[0].expense.group_id).toBe(-200);

      // Get all payments
      const allPayments = await db.getUserPayments(222);
      expect(allPayments).toHaveLength(2);
    });

    it('should return empty array when user has no payments', async () => {
      const payments = await db.getUserPayments(222);
      expect(payments).toEqual([]);
    });

    it('should record payment with transfer slip URL', async () => {
      await db.recordPayment(splitId, 222, 111, 50, 'https://example.com/slip.jpg');

      const payments = await db.getUserPayments(222);
      expect(payments).toHaveLength(1);
      expect(payments[0].transfer_slip_url).toBe('https://example.com/slip.jpg');
    });

    it('should order payments by paid_at descending', async () => {
      // Create multiple expenses and payments
      const expense2Result = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 75,
        split_type: 'equal'
      });
      await db.createExpenseSplit(expense2Result.id, 222, 37.5);
      const splits2 = await db.getExpenseSplits(expense2Result.id);

      // Record first payment
      await db.recordPayment(splitId, 222, 111, 50);

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      // Record second payment
      await db.recordPayment(splits2[0].id, 222, 111, 37.5);

      const payments = await db.getUserPayments(222);
      expect(payments).toHaveLength(2);
      // Most recent payment should be first
      expect(payments[0].amount).toBe(37.5);
      expect(payments[1].amount).toBe(50);
    });
  });

  describe('Summary operations', () => {
    beforeEach(async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });
      await db.createUser({ telegram_id: 222, first_name: 'User2' });
      await db.registerUserInGroup(-100, 111, 111);
      await db.registerUserInGroup(-100, 222, 111);
    });

    it('should get user summary', async () => {
      const expense1Result = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        split_type: 'equal'
      });

      const expense2Result = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 50,
        split_type: 'equal'
      });

      await db.createExpenseSplit(expense1Result.id, 222, 50);
      await db.createExpenseSplit(expense2Result.id, 222, 25);

      // Mark first split as paid
      const splits = await db.getExpenseSplits(expense1Result.id);
      await db.markSplitAsPaid(splits[0].id);

      const summary = await db.getUserSummary(222, -100);
      expect(summary.total_owed).toBe(25);
      expect(summary.total_paid).toBe(50);
      expect(summary.unpaid_count).toBe(1);
    });

    it('should return zeros for user with no expenses', async () => {
      const summary = await db.getUserSummary(222, -100);
      expect(summary.total_owed).toBe(0);
      expect(summary.total_paid).toBe(0);
      expect(summary.unpaid_count).toBe(0);
    });
  });

  describe('Reminder settings', () => {
    it('should set reminder settings', async () => {
      await db.setReminderSettings(-100, true, '10:00');

      const settings = await db.getReminderSettings(-100);
      expect(settings).toBeDefined();
      expect(settings?.enabled).toBe(1);
      expect(settings?.reminder_time).toBe('10:00');
    });

    it('should update reminder settings', async () => {
      await db.setReminderSettings(-100, true, '10:00');
      await db.setReminderSettings(-100, false, '11:00');

      const settings = await db.getReminderSettings(-100);
      expect(settings?.enabled).toBe(0);
      expect(settings?.reminder_time).toBe('11:00');
    });

    it('should update last reminder sent', async () => {
      await db.setReminderSettings(-100, true, '10:00');
      await db.updateLastReminderSent(-100);

      const settings = await db.getReminderSettings(-100);
      expect(settings?.last_reminder_sent).toBeDefined();
      expect(settings?.last_reminder_sent).toBeGreaterThan(0);
    });

    it('should get groups for reminder', async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });
      await db.createUser({ telegram_id: 222, first_name: 'User2' });

      const expenseResult = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        split_type: 'equal'
      });

      await db.createExpenseSplit(expenseResult.id, 222, 50);

      const groups = await db.getGroupsForReminder();
      expect(groups).toContain(-100);
    });

    it('should return empty array when no groups have unpaid expenses', async () => {
      const groups = await db.getGroupsForReminder();
      expect(groups).toEqual([]);
    });
  });

  describe('unregisterUserFromGroup', () => {
    beforeEach(async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });
      await db.createUser({ telegram_id: 222, first_name: 'User2' });
      await db.registerUserInGroup(-100, 111, 111);
      await db.registerUserInGroup(-100, 222, 111);
    });

    it('should successfully unregister user with no pending expenses', async () => {
      const result = await db.unregisterUserFromGroup(-100, 222);

      expect(result.success).toBe(true);
      expect(result.message).toBe('User successfully unregistered from group.');

      const isRegistered = await db.isUserInGroup(-100, 222);
      expect(isRegistered).toBe(false);
    });

    it('should prevent unregistering user with unpaid expenses', async () => {
      // Create an expense that user 222 owes
      const expenseResult = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        split_type: 'equal'
      });
      const expenseId = expenseResult.id;
      await db.createExpenseSplit(expenseId, 222, 50);

      const result = await db.unregisterUserFromGroup(-100, 222);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Cannot unregister user');
      expect(result.message).toContain('1 unpaid expense');
      expect(result.message).toContain('50.00');

      // User should still be registered
      const isRegistered = await db.isUserInGroup(-100, 222);
      expect(isRegistered).toBe(true);
    });

    it('should allow unregistering user after all expenses are paid', async () => {
      // Create and pay an expense
      const expenseResult = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        split_type: 'equal'
      });
      const expenseId = expenseResult.id;
      await db.createExpenseSplit(expenseId, 222, 50);
      const splits = await db.getExpenseSplits(expenseId);
      await db.markSplitAsPaid(splits[0].id);

      const result = await db.unregisterUserFromGroup(-100, 222);

      expect(result.success).toBe(true);
      const isRegistered = await db.isUserInGroup(-100, 222);
      expect(isRegistered).toBe(false);
    });

    it('should prevent unregistering with multiple unpaid expenses', async () => {
      // Create multiple expenses
      const expense1Result = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        split_type: 'equal'
      });
      await db.createExpenseSplit(expense1Result.id, 222, 50);

      const expense2Result = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 60,
        split_type: 'equal'
      });
      await db.createExpenseSplit(expense2Result.id, 222, 30);

      const result = await db.unregisterUserFromGroup(-100, 222);

      expect(result.success).toBe(false);
      expect(result.message).toContain('2 unpaid expense');
      expect(result.message).toContain('80.00'); // 50 + 30
    });

    it('should only check expenses for the specific group', async () => {
      // Create expense in group -100
      const expense1Result = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        split_type: 'equal'
      });
      await db.createExpenseSplit(expense1Result.id, 222, 50);

      // Register user in another group with no expenses
      await db.registerUserInGroup(-200, 222, 111);

      // Should be able to unregister from group -200 even though they owe in -100
      const result = await db.unregisterUserFromGroup(-200, 222);

      expect(result.success).toBe(true);
      const isRegisteredIn200 = await db.isUserInGroup(-200, 222);
      expect(isRegisteredIn200).toBe(false);

      // But should still be registered in -100
      const isRegisteredIn100 = await db.isUserInGroup(-100, 222);
      expect(isRegisteredIn100).toBe(true);
    });
  });
});
