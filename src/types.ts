export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  BILLS_BUCKET: R2Bucket;
  BOT_TOKEN: string;
  WEBHOOK_DOMAIN: string;
  R2_PUBLIC_URL: string;
}

export interface User {
  telegram_id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  created_at: number;
}

export interface PaymentDetail {
  id: number;
  user_id: number;
  payment_type: string;
  payment_info: string; // JSON string
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface GroupUser {
  id: number;
  group_id: number;
  user_id: number;
  registered_by: number;
  registered_at: number;
}

export interface Expense {
  id: number;
  group_id: number;
  group_expense_number: number;
  created_by: number;
  paid_by: number;
  amount: number;
  description?: string;
  location?: string;
  photo_url?: string;
  vendor_payment_slip_url?: string;
  split_type: 'equal' | 'custom';
  created_at: number;
}

export interface ExpenseSplit {
  id: number;
  expense_id: number;
  user_id: number;
  amount_owed: number;
  paid: number; // 0 or 1
  paid_at?: number;
}

export interface Payment {
  id: number;
  expense_split_id: number;
  paid_by: number;
  paid_to: number;
  amount: number;
  transfer_slip_url?: string;
  paid_at: number;
}

export interface ReminderSettings {
  group_id: number;
  enabled: number;
  reminder_time: string;
  last_reminder_sent?: number;
  timezone_offset: number; // Hours offset from UTC (e.g., +5.5, -5)
}

// Session data for multi-step operations
export interface ExpenseSession {
  step: 'amount' | 'description' | 'location' | 'photo' | 'vendor_slip' | 'users' | 'paid_by' | 'split_type' | 'custom_splits';
  group_id?: number;
  amount?: number;
  description?: string;
  location?: string;
  photo_url?: string;
  vendor_payment_slip_url?: string;
  selected_users?: number[];
  paid_by?: number;
  split_type?: 'equal' | 'custom';
  custom_splits?: { [user_id: number]: number };
}

export interface PaymentDetailSession {
  step: 'type' | 'info';
  payment_type?: string;
}

export interface MarkPaidSession {
  split_id: number;
  step: 'confirm' | 'photo';
}
