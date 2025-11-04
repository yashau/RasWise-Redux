import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from '../db';
import { createTestEnv, cleanupTestEnv } from './setup';
import type { Miniflare } from 'miniflare';
import type { Env } from '../types';

describe('Handler Integration Tests', () => {
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

  describe('Registration flow', () => {
    it('should register a user in a group', async () => {
      await db.createUser({
        telegram_id: 111,
        username: 'user1',
        first_name: 'User1'
      });

      await db.registerUserInGroup(-100, 111, 111);

      const isRegistered = await db.isUserInGroup(-100, 111);
      expect(isRegistered).toBe(true);

      const users = await db.getGroupUsers(-100);
      expect(users).toHaveLength(1);
      expect(users[0].telegram_id).toBe(111);
    });

    it('should set payment details', async () => {
      await db.createUser({
        telegram_id: 111,
        first_name: 'User1'
      });

      await db.addPaymentDetail(111, 'bank', {
        account_number: '1234567890'
      });

      const paymentDetail = await db.getActivePaymentDetail(111);
      expect(paymentDetail).toBeDefined();
      const info = JSON.parse(paymentDetail!.payment_info);
      expect(info.account_number).toBe('1234567890');
    });
  });

  describe('Expense creation flow', () => {
    beforeEach(async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });
      await db.createUser({ telegram_id: 222, first_name: 'User2' });
      await db.createUser({ telegram_id: 333, first_name: 'User3' });
      await db.registerUserInGroup(-100, 111, 111);
      await db.registerUserInGroup(-100, 222, 111);
      await db.registerUserInGroup(-100, 333, 111);
    });

    it('should create expense with equal split', async () => {
      const expenseId = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 300,
        description: 'Dinner',
        vendor_payment_slip_url: undefined,
        split_type: 'equal'
      });

      // Create equal splits for 3 users
      await db.createExpenseSplit(expenseId, 111, 100);
      await db.createExpenseSplit(expenseId, 222, 100);
      await db.createExpenseSplit(expenseId, 333, 100);

      const splits = await db.getExpenseSplits(expenseId);
      expect(splits).toHaveLength(3);
      expect(splits.every(s => s.amount_owed === 100)).toBe(true);
    });

    it('should create expense with custom split', async () => {
      const expenseId = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 300,
        description: 'Shopping',
        vendor_payment_slip_url: undefined,
        split_type: 'custom'
      });

      // Create custom splits
      await db.createExpenseSplit(expenseId, 111, 150);
      await db.createExpenseSplit(expenseId, 222, 100);
      await db.createExpenseSplit(expenseId, 333, 50);

      const splits = await db.getExpenseSplits(expenseId);
      expect(splits).toHaveLength(3);
      expect(splits.find(s => s.user_id === 111)?.amount_owed).toBe(150);
      expect(splits.find(s => s.user_id === 222)?.amount_owed).toBe(100);
      expect(splits.find(s => s.user_id === 333)?.amount_owed).toBe(50);
    });

    it('should track unpaid expenses per user', async () => {
      const expense1 = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        vendor_payment_slip_url: undefined,
        split_type: 'equal'
      });

      const expense2 = await db.createExpense({
        group_id: -100,
        created_by: 222,
        paid_by: 222,
        amount: 50,
        vendor_payment_slip_url: undefined,
        split_type: 'equal'
      });

      await db.createExpenseSplit(expense1, 222, 50);
      await db.createExpenseSplit(expense2, 222, 25);

      const unpaidSplits = await db.getUserUnpaidSplits(222, -100);
      expect(unpaidSplits).toHaveLength(2);

      const totalOwed = unpaidSplits.reduce((sum, s) => sum + s.amount_owed, 0);
      expect(totalOwed).toBe(75);
    });
  });

  describe('Payment flow', () => {
    let expenseId: number;
    let splitId: number;

    beforeEach(async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });
      await db.createUser({ telegram_id: 222, first_name: 'User2' });
      await db.registerUserInGroup(-100, 111, 111);
      await db.registerUserInGroup(-100, 222, 111);

      // Add payment details
      await db.addPaymentDetail(111, 'bank', {
        account_number: '1111111111'
      });

      expenseId = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        description: 'Test expense',
        vendor_payment_slip_url: undefined,
        split_type: 'equal'
      });

      await db.createExpenseSplit(expenseId, 222, 50);
      const splits = await db.getExpenseSplits(expenseId);
      splitId = splits[0].id;
    });

    it('should retrieve payment details for expense creator', async () => {
      const paymentDetail = await db.getActivePaymentDetail(111);
      expect(paymentDetail).toBeDefined();
      const info = JSON.parse(paymentDetail!.payment_info);
      expect(info.account_number).toBe('1111111111');
    });

    it('should mark expense as paid', async () => {
      await db.markSplitAsPaid(splitId);
      await db.recordPayment(splitId, 222, 111, 50, undefined);

      const unpaidSplits = await db.getUserUnpaidSplits(222, -100);
      expect(unpaidSplits).toHaveLength(0);

      const summary = await db.getUserSummary(222, -100);
      expect(summary.total_owed).toBe(0);
      expect(summary.total_paid).toBe(50);
    });
  });

  describe('Summary and history', () => {
    beforeEach(async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });
      await db.createUser({ telegram_id: 222, first_name: 'User2' });
      await db.registerUserInGroup(-100, 111, 111);
      await db.registerUserInGroup(-100, 222, 111);
    });

    it('should calculate accurate summary', async () => {
      // Create multiple expenses
      const expense1 = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        vendor_payment_slip_url: undefined,
        split_type: 'equal'
      });

      const expense2 = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 60,
        vendor_payment_slip_url: undefined,
        split_type: 'equal'
      });

      const expense3 = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 40,
        vendor_payment_slip_url: undefined,
        split_type: 'equal'
      });

      await db.createExpenseSplit(expense1, 222, 50);
      await db.createExpenseSplit(expense2, 222, 30);
      await db.createExpenseSplit(expense3, 222, 20);

      // Pay first expense
      const splits = await db.getExpenseSplits(expense1);
      await db.markSplitAsPaid(splits[0].id);

      const summary = await db.getUserSummary(222, -100);
      expect(summary.total_owed).toBe(50); // 30 + 20
      expect(summary.total_paid).toBe(50);
      expect(summary.unpaid_count).toBe(2);
    });

    it('should retrieve expense history', async () => {
      for (let i = 0; i < 5; i++) {
        await db.createExpense({
          group_id: -100,
          created_by: 111,
        paid_by: 111,
          amount: (i + 1) * 10,
          description: `Expense ${i + 1}`,
          vendor_payment_slip_url: undefined,
        split_type: 'equal'
        });
      }

      const expenses = await db.getGroupExpenses(-100);
      expect(expenses).toHaveLength(5);
      // Most recent first
      expect(expenses[0].description).toBe('Expense 5');
    });
  });

  describe('Reminder system', () => {
    beforeEach(async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });
      await db.createUser({ telegram_id: 222, first_name: 'User2' });
      await db.registerUserInGroup(-100, 111, 111);
      await db.registerUserInGroup(-100, 222, 111);
    });

    it('should identify groups with unpaid expenses', async () => {
      const expenseId = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        vendor_payment_slip_url: undefined,
        split_type: 'equal'
      });

      await db.createExpenseSplit(expenseId, 222, 50);

      const groups = await db.getGroupsForReminder();
      expect(groups).toContain(-100);
    });

    it('should not include groups with all paid expenses', async () => {
      const expenseId = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        vendor_payment_slip_url: undefined,
        split_type: 'equal'
      });

      await db.createExpenseSplit(expenseId, 222, 50);
      const splits = await db.getExpenseSplits(expenseId);
      await db.markSplitAsPaid(splits[0].id);

      const groups = await db.getGroupsForReminder();
      expect(groups).not.toContain(-100);
    });

    it('should manage reminder settings', async () => {
      await db.setReminderSettings(-100, true, '10:00');

      let settings = await db.getReminderSettings(-100);
      expect(settings?.enabled).toBe(1);

      await db.setReminderSettings(-100, false, '10:00');

      settings = await db.getReminderSettings(-100);
      expect(settings?.enabled).toBe(0);
    });

    it('should set and get group timezone', async () => {
      await db.setGroupTimezone(-100, 5.5);

      const offset = await db.getGroupTimezone(-100);
      expect(offset).toBe(5.5);
    });

    it('should default to UTC (0) when no timezone is set', async () => {
      const offset = await db.getGroupTimezone(-999);
      expect(offset).toBe(0);
    });

    it('should handle negative timezone offsets', async () => {
      await db.setGroupTimezone(-100, -5);

      const offset = await db.getGroupTimezone(-100);
      expect(offset).toBe(-5);
    });

    it('should update timezone when set multiple times', async () => {
      await db.setGroupTimezone(-100, 8);
      let offset = await db.getGroupTimezone(-100);
      expect(offset).toBe(8);

      await db.setGroupTimezone(-100, -3);
      offset = await db.getGroupTimezone(-100);
      expect(offset).toBe(-3);
    });

    it('should set timezone with reminder settings', async () => {
      await db.setReminderSettings(-100, true, '10:00', 5.5);

      const settings = await db.getReminderSettings(-100);
      expect(settings?.timezone_offset).toBe(5.5);
      expect(settings?.enabled).toBe(1);
    });
  });

  describe('Edge cases', () => {
    it('should handle multiple groups for same user', async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });

      await db.registerUserInGroup(-100, 111, 111);
      await db.registerUserInGroup(-200, 111, 111);

      const isInGroup1 = await db.isUserInGroup(-100, 111);
      const isInGroup2 = await db.isUserInGroup(-200, 111);

      expect(isInGroup1).toBe(true);
      expect(isInGroup2).toBe(true);
    });

    it('should handle user owing across multiple groups', async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });
      await db.createUser({ telegram_id: 222, first_name: 'User2' });

      const expense1 = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        vendor_payment_slip_url: undefined,
        split_type: 'equal'
      });

      const expense2 = await db.createExpense({
        group_id: -200,
        created_by: 111,
        paid_by: 111,
        amount: 50,
        vendor_payment_slip_url: undefined,
        split_type: 'equal'
      });

      await db.createExpenseSplit(expense1, 222, 50);
      await db.createExpenseSplit(expense2, 222, 25);

      const unpaidGroup1 = await db.getUserUnpaidSplits(222, -100);
      const unpaidGroup2 = await db.getUserUnpaidSplits(222, -200);
      const unpaidAll = await db.getUserUnpaidSplits(222);

      expect(unpaidGroup1).toHaveLength(1);
      expect(unpaidGroup2).toHaveLength(1);
      expect(unpaidAll).toHaveLength(2);
    });

    it('should handle zero amount expenses', async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });

      const expenseId = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 0,
        vendor_payment_slip_url: undefined,
        split_type: 'equal'
      });

      const expense = await db.getExpense(expenseId);
      expect(expense?.amount).toBe(0);
    });

    it('should handle expenses with no description or location', async () => {
      await db.createUser({ telegram_id: 111, first_name: 'User1' });

      const expenseId = await db.createExpense({
        group_id: -100,
        created_by: 111,
        paid_by: 111,
        amount: 100,
        vendor_payment_slip_url: undefined,
        split_type: 'equal'
      });

      const expense = await db.getExpense(expenseId);
      expect(expense?.description).toBeNull();
      expect(expense?.location).toBeNull();
    });
  });
});
