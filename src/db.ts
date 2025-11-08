import type { D1Database } from '@cloudflare/workers-types';
import type {
  User,
  AccountDetail,
  GroupUser,
  UserGroupMembership,
  Expense,
  ExpenseSplit,
  Payment,
  ReminderSettings
} from './types';

export class Database {
  constructor(private db: D1Database) {}

  // User operations
  async createUser(user: Omit<User, 'created_at'>): Promise<void> {
    await this.db.prepare(`
      INSERT OR REPLACE INTO users (telegram_id, username, first_name, last_name, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      user.telegram_id,
      user.username || null,
      user.first_name || null,
      user.last_name || null,
      Date.now()
    ).run();
  }

  async getUser(telegram_id: number): Promise<User | null> {
    const result = await this.db.prepare(`
      SELECT * FROM users WHERE telegram_id = ?
    `).bind(telegram_id).first<User>();
    return result;
  }

  // Account details operations
  async addAccountDetail(
    user_id: number,
    account_type: string,
    account_info: object
  ): Promise<void> {
    // Deactivate previous account details
    await this.db.prepare(`
      UPDATE account_details SET is_active = 0 WHERE user_id = ?
    `).bind(user_id).run();

    // Add new account detail
    await this.db.prepare(`
      INSERT INTO account_details (user_id, account_type, account_info, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      user_id,
      account_type,
      JSON.stringify(account_info),
      Date.now(),
      Date.now()
    ).run();
  }

  async getActiveAccountDetail(user_id: number): Promise<AccountDetail | null> {
    const result = await this.db.prepare(`
      SELECT * FROM account_details WHERE user_id = ? AND is_active = 1
    `).bind(user_id).first<AccountDetail>();
    return result;
  }

  // Group user operations
  async registerUserInGroup(
    group_id: number,
    user_id: number,
    registered_by: number
  ): Promise<void> {
    await this.db.prepare(`
      INSERT OR IGNORE INTO group_users (group_id, user_id, registered_by, registered_at)
      VALUES (?, ?, ?, ?)
    `).bind(group_id, user_id, registered_by, Date.now()).run();
  }

  async getGroupUsers(group_id: number): Promise<User[]> {
    const result = await this.db.prepare(`
      SELECT u.* FROM users u
      JOIN group_users gu ON u.telegram_id = gu.user_id
      WHERE gu.group_id = ?
    `).bind(group_id).all<User>();
    return result.results || [];
  }

  async isUserInGroup(group_id: number, user_id: number): Promise<boolean> {
    const result = await this.db.prepare(`
      SELECT 1 FROM group_users WHERE group_id = ? AND user_id = ?
    `).bind(group_id, user_id).first();
    return result !== null;
  }

  async unregisterUserFromGroup(group_id: number, user_id: number): Promise<{ success: boolean; message: string }> {
    // Check if user has any unpaid expenses in this group
    const unpaidSplits = await this.getUserUnpaidSplits(user_id, group_id);

    if (unpaidSplits.length > 0) {
      const totalOwed = unpaidSplits.reduce((sum, split) => sum + split.amount_owed, 0);
      return {
        success: false,
        message: `Cannot unregister user. They have ${unpaidSplits.length} unpaid expense(s) totaling ${totalOwed.toFixed(2)}.`
      };
    }

    // Remove user from group
    await this.db.prepare(`
      DELETE FROM group_users WHERE group_id = ? AND user_id = ?
    `).bind(group_id, user_id).run();

    return {
      success: true,
      message: 'User successfully unregistered from group.'
    };
  }

  // User group membership operations (for tracking actual Telegram memberships)
  async addOrUpdateGroupMembership(
    user_id: number,
    group_id: number,
    group_title?: string,
    group_username?: string
  ): Promise<void> {
    const now = Date.now();
    // Convert undefined to null for D1
    const title = group_title ?? null;
    const username = group_username ?? null;

    await this.db.prepare(`
      INSERT INTO user_group_memberships (user_id, group_id, group_title, group_username, joined_at, is_member, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(user_id, group_id) DO UPDATE SET
        group_title = COALESCE(?, group_title),
        group_username = COALESCE(?, group_username),
        is_member = 1,
        updated_at = ?
    `).bind(
      user_id, group_id, title, username, now, now,
      title, username, now
    ).run();
  }

  async removeGroupMembership(user_id: number, group_id: number): Promise<void> {
    await this.db.prepare(`
      UPDATE user_group_memberships
      SET is_member = 0, updated_at = ?
      WHERE user_id = ? AND group_id = ?
    `).bind(Date.now(), user_id, group_id).run();
  }

  async getUserGroups(user_id: number): Promise<UserGroupMembership[]> {
    const result = await this.db.prepare(`
      SELECT * FROM user_group_memberships
      WHERE user_id = ? AND is_member = 1
      ORDER BY group_title ASC
    `).bind(user_id).all<UserGroupMembership>();
    return result.results || [];
  }

  async getGroupMembers(group_id: number): Promise<number[]> {
    const result = await this.db.prepare(`
      SELECT user_id FROM user_group_memberships
      WHERE group_id = ? AND is_member = 1
    `).bind(group_id).all<{ user_id: number }>();
    return (result.results || []).map(r => r.user_id);
  }

  // Expense operations
  async createExpense(expense: Omit<Expense, 'id' | 'group_expense_number' | 'created_at'>): Promise<{ id: number; group_expense_number: number }> {
    // Get and increment the group expense counter
    // First, ensure the counter exists for this group
    await this.db.prepare(`
      INSERT INTO group_expense_counters (group_id, last_expense_number)
      VALUES (?, 0)
      ON CONFLICT(group_id) DO NOTHING
    `).bind(expense.group_id).run();

    // Increment the counter and get the new number
    await this.db.prepare(`
      UPDATE group_expense_counters
      SET last_expense_number = last_expense_number + 1
      WHERE group_id = ?
    `).bind(expense.group_id).run();

    // Get the new expense number
    const counterResult = await this.db.prepare(`
      SELECT last_expense_number
      FROM group_expense_counters
      WHERE group_id = ?
    `).bind(expense.group_id).first<{ last_expense_number: number }>();

    const nextGroupExpenseNumber = counterResult!.last_expense_number;

    const result = await this.db.prepare(`
      INSERT INTO expenses (group_id, group_expense_number, created_by, paid_by, amount, description, location, photo_url, vendor_payment_slip_url, split_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id, group_expense_number
    `).bind(
      expense.group_id,
      nextGroupExpenseNumber,
      expense.created_by,
      expense.paid_by,
      expense.amount,
      expense.description || null,
      expense.location || null,
      expense.photo_url || null,
      expense.vendor_payment_slip_url || null,
      expense.split_type,
      Date.now()
    ).first<{ id: number; group_expense_number: number }>();
    return result!;
  }

  async getExpense(expense_id: number): Promise<Expense | null> {
    return await this.db.prepare(`
      SELECT * FROM expenses WHERE id = ?
    `).bind(expense_id).first<Expense>();
  }

  async getGroupExpenses(group_id: number, limit: number = 50): Promise<Expense[]> {
    const result = await this.db.prepare(`
      SELECT * FROM expenses WHERE group_id = ? ORDER BY created_at DESC LIMIT ?
    `).bind(group_id, limit).all<Expense>();
    return result.results || [];
  }

  // Expense split operations
  async createExpenseSplit(
    expense_id: number,
    user_id: number,
    amount_owed: number
  ): Promise<void> {
    await this.db.prepare(`
      INSERT INTO expense_splits (expense_id, user_id, amount_owed)
      VALUES (?, ?, ?)
    `).bind(expense_id, user_id, amount_owed).run();
  }

  async getExpenseSplits(expense_id: number): Promise<ExpenseSplit[]> {
    const result = await this.db.prepare(`
      SELECT * FROM expense_splits WHERE expense_id = ?
    `).bind(expense_id).all<ExpenseSplit>();
    return result.results || [];
  }

  async getExpenseSplit(split_id: number): Promise<ExpenseSplit | null> {
    const result = await this.db.prepare(`
      SELECT * FROM expense_splits WHERE id = ?
    `).bind(split_id).first<ExpenseSplit>();
    return result;
  }

  async getUserUnpaidSplits(user_id: number, group_id?: number): Promise<(ExpenseSplit & { expense: Expense })[]> {
    let query = `
      SELECT es.id as split_id, es.expense_id, es.user_id, es.amount_owed, es.paid, es.paid_at,
             e.*
      FROM expense_splits es
      JOIN expenses e ON es.expense_id = e.id
      WHERE es.user_id = ? AND es.paid = 0
    `;
    const bindings: any[] = [user_id];

    if (group_id) {
      query += ` AND e.group_id = ?`;
      bindings.push(group_id);
    }

    query += ` ORDER BY e.created_at DESC`;

    const result = await this.db.prepare(query).bind(...bindings).all<any>();

    return (result.results || []).map(row => ({
      id: row.split_id,
      expense_id: row.expense_id,
      user_id: row.user_id,
      amount_owed: row.amount_owed,
      paid: row.paid,
      paid_at: row.paid_at,
      expense: {
        id: row.id,
        group_id: row.group_id,
        group_expense_number: row.group_expense_number,
        created_by: row.created_by,
        paid_by: row.paid_by,
        amount: row.amount,
        description: row.description,
        location: row.location,
        photo_url: row.photo_url,
        vendor_payment_slip_url: row.vendor_payment_slip_url,
        split_type: row.split_type,
        created_at: row.created_at
      }
    }));
  }

  async markSplitAsPaid(split_id: number): Promise<void> {
    await this.db.prepare(`
      UPDATE expense_splits SET paid = 1, paid_at = ? WHERE id = ?
    `).bind(Date.now(), split_id).run();
  }

  // Payment operations
  async recordPayment(
    expense_split_id: number,
    paid_by: number,
    paid_to: number,
    amount: number,
    transfer_slip_url?: string
  ): Promise<void> {
    await this.db.prepare(`
      INSERT INTO payments (expense_split_id, paid_by, paid_to, amount, transfer_slip_url, paid_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(expense_split_id, paid_by, paid_to, amount, transfer_slip_url || null, Date.now()).run();
  }

  async getUserPayments(user_id: number, group_id?: number): Promise<(Payment & { expense: Expense })[]> {
    let query = `
      SELECT
        p.id as payment_id,
        p.expense_split_id,
        p.paid_by,
        p.paid_to,
        p.amount as payment_amount,
        p.transfer_slip_url,
        p.paid_at,
        e.id as expense_id,
        e.group_id,
        e.created_by,
        e.paid_by as expense_paid_by,
        e.amount as expense_amount,
        e.description,
        e.location,
        e.photo_url,
        e.vendor_payment_slip_url,
        e.split_type,
        e.created_at
      FROM payments p
      JOIN expense_splits es ON p.expense_split_id = es.id
      JOIN expenses e ON es.expense_id = e.id
      WHERE p.paid_by = ?
    `;
    const bindings: any[] = [user_id];

    if (group_id) {
      query += ` AND e.group_id = ?`;
      bindings.push(group_id);
    }

    query += ` ORDER BY p.paid_at DESC`;

    const result = await this.db.prepare(query).bind(...bindings).all<any>();

    return (result.results || []).map(row => ({
      id: row.payment_id,
      expense_split_id: row.expense_split_id,
      paid_by: row.paid_by,
      paid_to: row.paid_to,
      amount: row.payment_amount,
      transfer_slip_url: row.transfer_slip_url,
      paid_at: row.paid_at,
      expense: {
        id: row.expense_id,
        group_id: row.group_id,
        created_by: row.created_by,
        paid_by: row.expense_paid_by,
        amount: row.expense_amount,
        description: row.description,
        location: row.location,
        photo_url: row.photo_url,
        vendor_payment_slip_url: row.vendor_payment_slip_url,
        split_type: row.split_type,
        created_at: row.created_at
      }
    }));
  }

  // Summary operations
  async getUserSummary(user_id: number, group_id: number): Promise<{
    total_owed: number;
    total_paid: number;
    unpaid_count: number;
  }> {
    const result = await this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN es.paid = 0 THEN es.amount_owed ELSE 0 END), 0) as total_owed,
        COALESCE(SUM(CASE WHEN es.paid = 1 THEN es.amount_owed ELSE 0 END), 0) as total_paid,
        COUNT(CASE WHEN es.paid = 0 THEN 1 END) as unpaid_count
      FROM expense_splits es
      JOIN expenses e ON es.expense_id = e.id
      WHERE es.user_id = ? AND e.group_id = ?
    `).bind(user_id, group_id).first<any>();

    return {
      total_owed: result?.total_owed || 0,
      total_paid: result?.total_paid || 0,
      unpaid_count: result?.unpaid_count || 0
    };
  }

  // Reminder settings
  async getReminderSettings(group_id: number): Promise<ReminderSettings | null> {
    return await this.db.prepare(`
      SELECT * FROM reminder_settings WHERE group_id = ?
    `).bind(group_id).first<ReminderSettings>();
  }

  async setReminderSettings(
    group_id: number,
    enabled: boolean,
    reminder_time: string,
    timezone_offset?: number
  ): Promise<void> {
    if (timezone_offset !== undefined) {
      await this.db.prepare(`
        INSERT OR REPLACE INTO reminder_settings (group_id, enabled, reminder_time, timezone_offset)
        VALUES (?, ?, ?, ?)
      `).bind(group_id, enabled ? 1 : 0, reminder_time, timezone_offset).run();
    } else {
      await this.db.prepare(`
        INSERT OR REPLACE INTO reminder_settings (group_id, enabled, reminder_time)
        VALUES (?, ?, ?)
      `).bind(group_id, enabled ? 1 : 0, reminder_time).run();
    }
  }

  async setGroupTimezone(group_id: number, timezone_offset: number): Promise<void> {
    await this.db.prepare(`
      INSERT INTO reminder_settings (group_id, timezone_offset)
      VALUES (?, ?)
      ON CONFLICT(group_id) DO UPDATE SET timezone_offset = ?
    `).bind(group_id, timezone_offset, timezone_offset).run();
  }

  async getGroupTimezone(group_id: number): Promise<number> {
    const settings = await this.getReminderSettings(group_id);
    return settings?.timezone_offset ?? 0; // Default to UTC if not set
  }

  async setGroupCurrency(group_id: number, currency: string): Promise<void> {
    await this.db.prepare(`
      INSERT INTO reminder_settings (group_id, currency)
      VALUES (?, ?)
      ON CONFLICT(group_id) DO UPDATE SET currency = ?
    `).bind(group_id, currency, currency).run();
  }

  async getGroupCurrency(group_id: number): Promise<string> {
    const settings = await this.getReminderSettings(group_id);
    return settings?.currency ?? '$'; // Default to $ if not set
  }

  async updateLastReminderSent(group_id: number): Promise<void> {
    await this.db.prepare(`
      UPDATE reminder_settings SET last_reminder_sent = ? WHERE group_id = ?
    `).bind(Date.now(), group_id).run();
  }

  async getGroupsForReminder(): Promise<number[]> {
    const result = await this.db.prepare(`
      SELECT DISTINCT e.group_id
      FROM expenses e
      JOIN expense_splits es ON e.id = es.expense_id
      WHERE es.paid = 0
    `).all<{ group_id: number }>();
    return (result.results || []).map(r => r.group_id);
  }
}
