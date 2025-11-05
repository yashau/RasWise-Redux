-- Backfill group_expense_number for existing expenses
-- This assigns sequential numbers within each group based on created_at
UPDATE expenses
SET group_expense_number = (
  SELECT COUNT(*)
  FROM expenses e2
  WHERE e2.group_id = expenses.group_id
    AND e2.created_at <= expenses.created_at
)
WHERE group_expense_number IS NULL;
