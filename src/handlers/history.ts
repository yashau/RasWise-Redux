import { Context } from 'grammy/web';
import { Database } from '../db';
import type { User } from '../types';
import { formatDate, formatUserName, formatAmount, sendDMWithFallback, getPublicPhotoUrl } from '../utils';

export async function handleMyExpenses(ctx: Context, db: Database, r2PublicUrl: string) {
  const userId = ctx.from!.id;

  // Determine which group to show expenses from
  let groupId: number | undefined;

  if (ctx.chat?.type !== 'private') {
    // Command used in a group - use that group
    groupId = ctx.chat!.id;
  }

  // Get timezone offset for the group
  const timezoneOffset = groupId ? await db.getGroupTimezone(groupId) : 0;

  // Get user's unpaid splits
  const unpaidSplits = await db.getUserUnpaidSplits(userId, groupId);

  // Get user's payment history
  const payments = await db.getUserPayments(userId, groupId);

  if (unpaidSplits.length === 0 && payments.length === 0) {
    await ctx.api.sendMessage(
      userId,
      '*Great news:* You have no pending expenses and no payment history!' +
      (groupId ? ' (in this group)' : ''),
      { parse_mode: 'Markdown' }
    );
    return;
  }

  let message = '';

  // Show pending expenses
  if (unpaidSplits.length > 0) {
    message += '*Your Pending Expenses:*\n\n';

    for (const split of unpaidSplits) {
      const expense = split.expense;
      const paidBy = await db.getUser(expense.paid_by);
      const paidByName = formatUserName(paidBy, expense.paid_by);

      message += `*Expense #${expense.group_expense_number}*\n`;
      message += `Total amount: ${formatAmount(expense.amount)}\n`;
      message += `Amount you owe: ${formatAmount(split.amount_owed)}\n`;
      if (expense.description) message += `Description: ${expense.description}\n`;
      if (expense.location) message += `Location: ${expense.location}\n`;
      if (expense.photo_url) message += `*Bill photo:* [View](${getPublicPhotoUrl(expense.photo_url, r2PublicUrl)})\n`;
      if (expense.vendor_payment_slip_url) message += `*Vendor slip:* [View](${getPublicPhotoUrl(expense.vendor_payment_slip_url, r2PublicUrl)})\n`;
      message += `Fronted by: ${paidByName}\n`;
      message += `Date: ${formatDate(expense.created_at, timezoneOffset)}\n`;
      message += `\n`;
    }

    message += `Total pending: ${formatAmount(unpaidSplits.reduce((sum, s) => sum + s.amount_owed, 0))}\n`;
  }

  // Show payment history
  if (payments.length > 0) {
    message += `\n━━━━━━━━━━━━━━━━\n\n`;
    message += `*Your Payment History:*\n\n`;

    for (const payment of payments) {
      const expense = payment.expense;
      const paidTo = await db.getUser(payment.paid_to);
      const paidToName = formatUserName(paidTo, payment.paid_to);

      message += `*Payment #${payment.id}*\n`;
      message += `Amount paid: ${formatAmount(payment.amount)}\n`;
      message += `Paid to: ${paidToName}\n`;
      if (expense.description) message += `For: ${expense.description}\n`;
      if (expense.location) message += `Location: ${expense.location}\n`;
      if (payment.transfer_slip_url) message += `*Transfer slip:* [View](${getPublicPhotoUrl(payment.transfer_slip_url, r2PublicUrl)})\n`;
      message += `Date: ${formatDate(payment.paid_at, timezoneOffset)}\n`;
      message += `\n`;
    }

    message += `Total paid: ${formatAmount(payments.reduce((sum, p) => sum + p.amount, 0))}\n`;
  }

  message += `\n\nUse /summary for a cumulative summary`;
  message += `\nUse /pay to mark expenses as paid`;

  await sendDMWithFallback(ctx, userId, message);
}

export async function handleSummary(ctx: Context, db: Database) {
  const userId = ctx.from!.id;

  let groupId: number | undefined;

  if (ctx.chat?.type !== 'private') {
    groupId = ctx.chat!.id;
  }

  if (!groupId) {
    await ctx.reply('Please use this command in a group chat to see your summary for that group.');
    return;
  }

  // Get summary
  const summary = await db.getUserSummary(userId, groupId);

  // Get breakdown by person
  const unpaidSplits = await db.getUserUnpaidSplits(userId, groupId);

  // Group by creator (who you owe)
  const oweByPerson: { [key: number]: { name: string; amount: number; count: number } } = {};

  for (const split of unpaidSplits) {
    const creatorId = split.expense.created_by;
    if (!oweByPerson[creatorId]) {
      const creator = await db.getUser(creatorId);
      oweByPerson[creatorId] = {
        name: formatUserName(creator, creatorId),
        amount: 0,
        count: 0
      };
    }
    oweByPerson[creatorId].amount += split.amount_owed;
    oweByPerson[creatorId].count += 1;
  }

  let message = '*Your Expense Summary:*\n\n';
  message += `*Total Unpaid:* ${formatAmount(summary.total_owed)}\n`;
  message += `*Total Paid:* ${formatAmount(summary.total_paid)}\n`;
  message += `*Pending Expenses:* ${summary.unpaid_count}\n\n`;

  if (Object.keys(oweByPerson).length > 0) {
    message += '*You owe:*\n';
    for (const [creatorId, info] of Object.entries(oweByPerson)) {
      message += `  • ${info.name}: ${formatAmount(info.amount)} (${info.count} expense${info.count > 1 ? 's' : ''})\n`;
    }
  } else {
    message += '*Great news:* You don\'t owe anyone!\n';
  }

  message += `\nUse /myexpenses to see detailed breakdown`;
  message += `\nUse /pay to mark expenses as paid`;

  await sendDMWithFallback(ctx, userId, message);
}

export async function handleHistory(ctx: Context, db: Database, r2PublicUrl: string) {
  const userId = ctx.from!.id;

  let groupId: number | undefined;

  if (ctx.chat?.type !== 'private') {
    groupId = ctx.chat!.id;
  }

  if (!groupId) {
    await ctx.reply('Please use this command in a group chat to see the history for that group.');
    return;
  }

  // Get timezone offset for the group
  const timezoneOffset = await db.getGroupTimezone(groupId);

  // Get all expenses for the group
  const expenses = await db.getGroupExpenses(groupId, 20); // Last 20 expenses

  if (expenses.length === 0) {
    await ctx.api.sendMessage(userId, 'No expenses recorded yet in this group.');
    return;
  }

  let message = '*Recent Expense History:*\n\n';

  for (const expense of expenses) {
    const creator = await db.getUser(expense.created_by);
    const creatorName = formatUserName(creator, expense.created_by);

    const splits = await db.getExpenseSplits(expense.id);
    const paidCount = splits.filter(s => s.paid === 1).length;

    message += `*Expense #${expense.group_expense_number}*\n`;
    message += `   Amount: ${formatAmount(expense.amount)}\n`;
    if (expense.description) message += `   Description: ${expense.description}\n`;
    if (expense.location) message += `   Location: ${expense.location}\n`;
    if (expense.photo_url) message += `   Bill photo: [View](${getPublicPhotoUrl(expense.photo_url, r2PublicUrl)})\n`;
    if (expense.vendor_payment_slip_url) message += `   Vendor slip: [View](${getPublicPhotoUrl(expense.vendor_payment_slip_url, r2PublicUrl)})\n`;
    message += `   By: ${creatorName} | ${formatDate(expense.created_at, timezoneOffset)}\n`;
    message += `   Split: ${expense.split_type} among ${splits.length} user(s)\n`;
    message += `   Status: ${paidCount}/${splits.length} paid\n\n`;
  }

  message += `\nShowing last ${expenses.length} expenses`;

  await sendDMWithFallback(ctx, userId, message);
}

export async function handleExpenseDetail(ctx: Context, db: Database, expenseId: number, r2PublicUrl: string) {
  const userId = ctx.from!.id;

  const expense = await db.getExpense(expenseId);

  if (!expense) {
    return ctx.reply('Expense not found.');
  }

  // Get timezone offset for the group
  const timezoneOffset = await db.getGroupTimezone(expense.group_id);

  // Check if user is part of this expense or created it
  const splits = await db.getExpenseSplits(expenseId);
  const userSplit = splits.find(s => s.user_id === userId);
  const isCreator = expense.created_by === userId;

  if (!userSplit && !isCreator) {
    return ctx.reply('You don\'t have access to this expense.');
  }

  const creator = await db.getUser(expense.created_by);
  const creatorName = formatUserName(creator, expense.created_by);

  let message = `*Expense #${expense.group_expense_number} Details:*\n\n`;
  message += `Amount: ${formatAmount(expense.amount)}\n`;
  if (expense.description) message += `Description: ${expense.description}\n`;
  if (expense.location) message += `Location: ${expense.location}\n`;
  if (expense.photo_url) message += `*Bill photo:* [View](${getPublicPhotoUrl(expense.photo_url, r2PublicUrl)})\n`;
  if (expense.vendor_payment_slip_url) message += `*Vendor slip:* [View](${getPublicPhotoUrl(expense.vendor_payment_slip_url, r2PublicUrl)})\n`;
  message += `Created by: ${creatorName}\n`;
  message += `Date: ${formatDate(expense.created_at, timezoneOffset)}\n`;
  message += `Split type: ${expense.split_type}\n\n`;

  message += `*Split details:*\n`;
  for (const split of splits) {
    const user = await db.getUser(split.user_id);
    const userName = formatUserName(user, split.user_id);
    const status = split.paid ? '*Paid*' : '*Unpaid*';
    message += `  • ${userName}: ${formatAmount(split.amount_owed)} ${status}\n`;
  }

  // Send to user's DM if possible, otherwise reply in chat
  try {
    await ctx.api.sendMessage(userId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    await ctx.reply(message, { parse_mode: 'Markdown' });
  }
}
