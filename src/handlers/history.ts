import { Context } from 'grammy/web';
import { Database } from '../db';
import type { User } from '../types';

export async function handleMyExpenses(ctx: Context, db: Database) {
  const userId = ctx.from!.id;

  // Determine which group to show expenses from
  let groupId: number | undefined;

  if (ctx.chat?.type !== 'private') {
    // Command used in a group - use that group
    groupId = ctx.chat!.id;

    // Notify in group that we're DMing
    await ctx.reply('📊 I\'ll send you your expense details in a DM!');
  }

  // Get user's unpaid splits
  const unpaidSplits = await db.getUserUnpaidSplits(userId, groupId);

  if (unpaidSplits.length === 0) {
    await ctx.api.sendMessage(
      userId,
      '🎉 You have no pending expenses!' +
      (groupId ? ' (in this group)' : '')
    );
    return;
  }

  let message = '📊 Your Pending Expenses:\n\n';

  for (const split of unpaidSplits) {
    const expense = split.expense;
    const creator = await db.getUser(expense.created_by);
    const creatorName = creator?.first_name || creator?.username || `User ${expense.created_by}`;

    message += `💰 Expense #${expense.id}\n`;
    message += `Amount owed: ${split.amount_owed.toFixed(2)}\n`;
    if (expense.description) message += `Description: ${expense.description}\n`;
    if (expense.location) message += `Location: ${expense.location}\n`;
    message += `Created by: ${creatorName}\n`;
    message += `Date: ${new Date(expense.created_at).toLocaleDateString()}\n`;
    message += `\n`;
  }

  message += `\nTotal pending: ${unpaidSplits.reduce((sum, s) => sum + s.amount_owed, 0).toFixed(2)}`;
  message += `\n\nUse /summary for a cumulative summary`;
  message += `\nUse /markpaid to mark expenses as paid`;

  try {
    await ctx.api.sendMessage(userId, message);
  } catch (error) {
    await ctx.reply(
      '❌ I couldn\'t send you a DM. Please start a chat with me first by clicking my name and pressing "Start".'
    );
  }
}

export async function handleSummary(ctx: Context, db: Database) {
  const userId = ctx.from!.id;

  let groupId: number | undefined;

  if (ctx.chat?.type !== 'private') {
    groupId = ctx.chat!.id;
    await ctx.reply('📊 I\'ll send you your summary in a DM!');
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
        name: creator?.first_name || creator?.username || `User ${creatorId}`,
        amount: 0,
        count: 0
      };
    }
    oweByPerson[creatorId].amount += split.amount_owed;
    oweByPerson[creatorId].count += 1;
  }

  let message = '📊 Your Expense Summary:\n\n';
  message += `💸 Total Unpaid: ${summary.total_owed.toFixed(2)}\n`;
  message += `✅ Total Paid: ${summary.total_paid.toFixed(2)}\n`;
  message += `📝 Pending Expenses: ${summary.unpaid_count}\n\n`;

  if (Object.keys(oweByPerson).length > 0) {
    message += '💰 You owe:\n';
    for (const [creatorId, info] of Object.entries(oweByPerson)) {
      message += `  • ${info.name}: ${info.amount.toFixed(2)} (${info.count} expense${info.count > 1 ? 's' : ''})\n`;
    }
  } else {
    message += '🎉 You don\'t owe anyone!\n';
  }

  message += `\nUse /myexpenses to see detailed breakdown`;
  message += `\nUse /markpaid to mark expenses as paid`;

  try {
    await ctx.api.sendMessage(userId, message);
  } catch (error) {
    await ctx.reply(
      '❌ I couldn\'t send you a DM. Please start a chat with me first by clicking my name and pressing "Start".'
    );
  }
}

export async function handleHistory(ctx: Context, db: Database) {
  const userId = ctx.from!.id;

  let groupId: number | undefined;

  if (ctx.chat?.type !== 'private') {
    groupId = ctx.chat!.id;
    await ctx.reply('📚 I\'ll send you the expense history in a DM!');
  }

  if (!groupId) {
    await ctx.reply('Please use this command in a group chat to see the history for that group.');
    return;
  }

  // Get all expenses for the group
  const expenses = await db.getGroupExpenses(groupId, 20); // Last 20 expenses

  if (expenses.length === 0) {
    await ctx.api.sendMessage(userId, 'No expenses recorded yet in this group.');
    return;
  }

  let message = '📚 Recent Expense History:\n\n';

  for (const expense of expenses) {
    const creator = await db.getUser(expense.created_by);
    const creatorName = creator?.first_name || creator?.username || `User ${expense.created_by}`;

    const splits = await db.getExpenseSplits(expense.id);
    const paidCount = splits.filter(s => s.paid === 1).length;

    message += `💰 #${expense.id} - ${expense.amount.toFixed(2)}\n`;
    if (expense.description) message += `   ${expense.description}\n`;
    message += `   By: ${creatorName} | ${new Date(expense.created_at).toLocaleDateString()}\n`;
    message += `   Split: ${expense.split_type} among ${splits.length} user(s)\n`;
    message += `   Status: ${paidCount}/${splits.length} paid\n\n`;
  }

  message += `\nShowing last ${expenses.length} expenses`;

  try {
    await ctx.api.sendMessage(userId, message);
  } catch (error) {
    await ctx.reply(
      '❌ I couldn\'t send you a DM. Please start a chat with me first by clicking my name and pressing "Start".'
    );
  }
}

export async function handleExpenseDetail(ctx: Context, db: Database, expenseId: number) {
  const userId = ctx.from!.id;

  const expense = await db.getExpense(expenseId);

  if (!expense) {
    return ctx.reply('Expense not found.');
  }

  // Check if user is part of this expense or created it
  const splits = await db.getExpenseSplits(expenseId);
  const userSplit = splits.find(s => s.user_id === userId);
  const isCreator = expense.created_by === userId;

  if (!userSplit && !isCreator) {
    return ctx.reply('You don\'t have access to this expense.');
  }

  const creator = await db.getUser(expense.created_by);
  const creatorName = creator?.first_name || creator?.username || `User ${expense.created_by}`;

  let message = `💰 Expense #${expense.id} Details:\n\n`;
  message += `Amount: ${expense.amount.toFixed(2)}\n`;
  if (expense.description) message += `Description: ${expense.description}\n`;
  if (expense.location) message += `Location: ${expense.location}\n`;
  message += `Created by: ${creatorName}\n`;
  message += `Date: ${new Date(expense.created_at).toLocaleDateString()}\n`;
  message += `Split type: ${expense.split_type}\n\n`;

  message += `👥 Split details:\n`;
  for (const split of splits) {
    const user = await db.getUser(split.user_id);
    const userName = user?.first_name || user?.username || `User ${split.user_id}`;
    const status = split.paid ? '✅ Paid' : '❌ Unpaid';
    message += `  • ${userName}: ${split.amount_owed.toFixed(2)} ${status}\n`;
  }

  // Send to user's DM if possible, otherwise reply in chat
  try {
    await ctx.api.sendMessage(userId, message);
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('📊 Sent expense details to your DM!');
    }
  } catch (error) {
    await ctx.reply(message);
  }
}
