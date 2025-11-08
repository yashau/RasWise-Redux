-- Users table
CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    created_at INTEGER NOT NULL
);

-- Account details table (bank accounts, UPI, etc.)
CREATE TABLE IF NOT EXISTS account_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    account_type TEXT NOT NULL, -- 'upi', 'bank', 'card', etc.
    account_info TEXT NOT NULL, -- JSON string with account details
    is_active INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
);

-- Group registrations (which users are registered in which groups)
CREATE TABLE IF NOT EXISTS group_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    registered_by INTEGER NOT NULL, -- who registered this user
    registered_at INTEGER NOT NULL,
    UNIQUE(group_id, user_id),
    FOREIGN KEY (user_id) REFERENCES users(telegram_id),
    FOREIGN KEY (registered_by) REFERENCES users(telegram_id)
);

-- User group memberships (tracks actual Telegram group membership for bot access)
CREATE TABLE IF NOT EXISTS user_group_memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    group_title TEXT,
    group_username TEXT,
    joined_at INTEGER NOT NULL,
    is_member INTEGER DEFAULT 1, -- 1 = active member, 0 = left
    updated_at INTEGER NOT NULL,
    UNIQUE(user_id, group_id),
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
);

-- Expenses table
CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    group_expense_number INTEGER, -- per-group expense numbering
    created_by INTEGER NOT NULL,
    paid_by INTEGER NOT NULL, -- who paid the full amount
    amount REAL NOT NULL,
    description TEXT,
    location TEXT,
    photo_url TEXT, -- R2 bucket URL for bill/receipt photo
    vendor_payment_slip_url TEXT, -- R2 bucket URL for payment slip to vendor
    split_type TEXT NOT NULL, -- 'equal' or 'custom'
    created_at INTEGER NOT NULL,
    FOREIGN KEY (created_by) REFERENCES users(telegram_id),
    FOREIGN KEY (paid_by) REFERENCES users(telegram_id)
);

-- Expense splits table
CREATE TABLE IF NOT EXISTS expense_splits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    amount_owed REAL NOT NULL,
    paid INTEGER DEFAULT 0, -- 0 = unpaid, 1 = paid
    paid_at INTEGER,
    FOREIGN KEY (expense_id) REFERENCES expenses(id),
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
);

-- Payment transactions (when users mark expenses as paid)
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_split_id INTEGER NOT NULL,
    paid_by INTEGER NOT NULL,
    paid_to INTEGER NOT NULL,
    amount REAL NOT NULL,
    transfer_slip_url TEXT, -- R2 bucket URL for bank transfer slip photo
    paid_at INTEGER NOT NULL,
    FOREIGN KEY (expense_split_id) REFERENCES expense_splits(id),
    FOREIGN KEY (paid_by) REFERENCES users(telegram_id),
    FOREIGN KEY (paid_to) REFERENCES users(telegram_id)
);

-- Reminder settings per group
CREATE TABLE IF NOT EXISTS reminder_settings (
    group_id INTEGER PRIMARY KEY,
    enabled INTEGER DEFAULT 1,
    reminder_time TEXT DEFAULT '10:00', -- HH:MM format
    last_reminder_sent INTEGER,
    timezone_offset REAL DEFAULT 0, -- Hours offset from UTC (e.g., +5.5 for IST, -5 for EST)
    currency TEXT DEFAULT '$' -- Preferred currency symbol/code for the group
);

-- Group expense counters to ensure sequential numbering even after deletions
CREATE TABLE IF NOT EXISTS group_expense_counters (
    group_id INTEGER PRIMARY KEY,
    last_expense_number INTEGER NOT NULL DEFAULT 0
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_account_details_user ON account_details(user_id);
CREATE INDEX IF NOT EXISTS idx_group_users_group ON group_users(group_id);
CREATE INDEX IF NOT EXISTS idx_group_users_user ON group_users(user_id);
CREATE INDEX IF NOT EXISTS idx_user_group_memberships_user ON user_group_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_user_group_memberships_group ON user_group_memberships(group_id);
CREATE INDEX IF NOT EXISTS idx_user_group_memberships_active ON user_group_memberships(user_id, is_member) WHERE is_member = 1;
CREATE INDEX IF NOT EXISTS idx_expenses_group ON expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_expenses_group_number ON expenses(group_id, group_expense_number);
CREATE INDEX IF NOT EXISTS idx_expense_splits_expense ON expense_splits(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_splits_user ON expense_splits(user_id);
CREATE INDEX IF NOT EXISTS idx_expense_splits_unpaid ON expense_splits(paid) WHERE paid = 0;
