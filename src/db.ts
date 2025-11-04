import type { D1Database } from '@cloudflare/workers-types';
import type {
  User,
  PaymentDetail,
  GroupUser,
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

  // Payment details operations
  async addPaymentDetail(
    user_id: number,
    payment_type: string,
    payment_info: object
  ): Promise<void> {
    // Deactivate previous payment details
    await this.db.prepare(`
      UPDATE payment_details SET is_active = 0 WHERE user_id = ?
    `).bind(user_id).run();

    // Add new payment detail
    await this.db.prepare(`
      INSERT INTO payment_details (user_id, payment_type, payment_info, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      user_id,
      payment_type,
      JSON.stringify(payment_info),
      Date.now(),
      Date.now()
    ).run();
  }

  async getActivePaymentDetail(user_id: number): Promise<PaymentDetail | null> {
    const result = await this.db.prepare(`
      SELECT * FROM payment_details WHERE user_id = ? AND is_active = 1
    `).bind(user_id).first<PaymentDetail>();
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

  // Expense operations
  async createExpense(expense: Omit<Expense, 'id' | 'created_at'>): Promise<number> {
    const result = await this.db.prepare(`
      INSERT INTO expenses (group_id, created_by, amount, description, location, photo_url, split_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `).bind(
      expense.group_id,
      expense.created_by,
      expense.amount,
      expense.description || null,
      expense.location || null,
      expense.photo_url || null,
      expense.split_type,
      Date.now()
    ).first<{ id: number }>();
    return result!.id;
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

  async getUserUnpaidSplits(user_id: number, group_id?: number): Promise<(ExpenseSplit & { expense: Expense })[]> {
    let query = `
      SELECT es.*, e.* FROM expense_splits es
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
      id: row.id,
      expense_id: row.expense_id,
      user_id: row.user_id,
      amount_owed: row.amount_owed,
      paid: row.paid,
      paid_at: row.paid_at,
      expense: {
        id: row.expense_id,
        group_id: row.group_id,
        created_by: row.created_by,
        amount: row.amount,
        description: row.description,
        location: row.location,
        photo_url: row.photo_url,
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
    amount: number
  ): Promise<void> {
    await this.db.prepare(`
      INSERT INTO payments (expense_split_id, paid_by, paid_to, amount, paid_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(expense_split_id, paid_by, paid_to, amount, Date.now()).run();
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
    reminder_time: string
  ): Promise<void> {
    await this.db.prepare(`
      INSERT OR REPLACE INTO reminder_settings (group_id, enabled, reminder_time)
      VALUES (?, ?, ?)
    `).bind(group_id, enabled ? 1 : 0, reminder_time).run();
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
