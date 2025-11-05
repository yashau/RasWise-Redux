-- Add group_expense_number column to expenses table
ALTER TABLE expenses ADD COLUMN group_expense_number INTEGER;

-- Create index for group_expense_number lookups
CREATE INDEX IF NOT EXISTS idx_expenses_group_number ON expenses(group_id, group_expense_number);
