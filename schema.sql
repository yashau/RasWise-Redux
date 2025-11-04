-- Users table
CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    created_at INTEGER NOT NULL
);

-- Payment details table
CREATE TABLE IF NOT EXISTS payment_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    payment_type TEXT NOT NULL, -- 'upi', 'bank', 'card', etc.
    payment_info TEXT NOT NULL, -- JSON string with payment details
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

-- Expenses table
CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
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
    timezone_offset REAL DEFAULT 0 -- Hours offset from UTC (e.g., +5.5 for IST, -5 for EST)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_payment_details_user ON payment_details(user_id);
CREATE INDEX IF NOT EXISTS idx_group_users_group ON group_users(group_id);
CREATE INDEX IF NOT EXISTS idx_group_users_user ON group_users(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_group ON expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_expense_splits_expense ON expense_splits(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_splits_user ON expense_splits(user_id);
CREATE INDEX IF NOT EXISTS idx_expense_splits_unpaid ON expense_splits(paid) WHERE paid = 0;
