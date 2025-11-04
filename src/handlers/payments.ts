import { Context, InlineKeyboard } from 'grammy/web';
import { Database } from '../db';

export async function handleMarkPaid(ctx: Context, db: Database) {
  const userId = ctx.from!.id;

  let groupId: number | undefined;

  if (ctx.chat?.type !== 'private') {
    groupId = ctx.chat!.id;
  }

  // Get user's unpaid splits
  const unpaidSplits = await db.getUserUnpaidSplits(userId, groupId);

  if (unpaidSplits.length === 0) {
    return ctx.reply('🎉 You have no pending expenses to mark as paid!');
  }

  // Create inline keyboard with expenses
  const keyboard = new InlineKeyboard();

  for (const split of unpaidSplits.slice(0, 10)) { // Show max 10 at a time
    const expense = split.expense;
    const label = `#${expense.id} - ${split.amount_owed.toFixed(2)}${expense.description ? ` (${expense.description.substring(0, 20)})` : ''}`;
    keyboard.text(label, `markpaid:${split.id}`).row();
  }

  let message = '💸 Select an expense to mark as paid:\n\n';

  if (unpaidSplits.length > 10) {
    message += `Showing 10 of ${unpaidSplits.length} pending expenses.\n`;
    message += 'Use /myexpenses to see all.\n\n';
  }

  await ctx.reply(message, { reply_markup: keyboard });
}

export async function handleMarkPaidCallback(
  ctx: Context,
  db: Database,
  splitId: number
) {
  const userId = ctx.from!.id;

  // Get the split to verify ownership
  const splits = await db.getUserUnpaidSplits(userId);
  const split = splits.find(s => s.id === splitId);

  if (!split) {
    return ctx.answerCallbackQuery({
      text: 'Expense not found or already paid',
      show_alert: true
    });
  }

  const expense = split.expense;

  // Get creator's payment details
  const creatorPayment = await db.getActivePaymentDetail(expense.created_by);

  if (!creatorPayment) {
    await ctx.answerCallbackQuery();
    return ctx.reply(
      '⚠️ The person who created this expense hasn\'t set up payment details yet.\n' +
      'Ask them to use /setpayment to add their payment information.'
    );
  }

  const paymentInfo = JSON.parse(creatorPayment.payment_info);
  const creator = await db.getUser(expense.created_by);
  const creatorName = creator?.first_name || creator?.username || `User ${expense.created_by}`;

  let message = `💸 Payment Details for Expense #${expense.id}:\n\n`;
  message += `Amount to pay: ${split.amount_owed.toFixed(2)}\n`;
  if (expense.description) message += `For: ${expense.description}\n`;
  message += `\nPay to: ${creatorName}\n`;
  message += `Bank Account: ${paymentInfo.account_number}\n\n`;
  message += `Once you've paid, click the button below to mark as paid.`;

  const keyboard = new InlineKeyboard()
    .text('✅ I\'ve Paid This', `confirmpaid:${splitId}`)
    .row()
    .text('❌ Cancel', 'cancel_payment');

  await ctx.answerCallbackQuery();
  await ctx.reply(message, { reply_markup: keyboard });
}

export async function handleConfirmPaid(
  ctx: Context,
  db: Database,
  splitId: number
) {
  const userId = ctx.from!.id;

  // Verify ownership again
  const splits = await db.getUserUnpaidSplits(userId);
  const split = splits.find(s => s.id === splitId);

  if (!split) {
    return ctx.answerCallbackQuery({
      text: 'Expense not found or already paid',
      show_alert: true
    });
  }

  const expense = split.expense;

  // Mark as paid
  await db.markSplitAsPaid(splitId);

  // Record payment transaction
  await db.recordPayment(
    splitId,
    userId,
    expense.created_by,
    split.amount_owed
  );

  // Notify the creator
  const payer = await db.getUser(userId);
  const payerName = payer?.first_name || payer?.username || `User ${userId}`;

  try {
    await ctx.api.sendMessage(
      expense.created_by,
      `✅ ${payerName} marked their payment as paid!\n\n` +
      `Expense #${expense.id}\n` +
      `Amount: ${split.amount_owed.toFixed(2)}\n` +
      (expense.description ? `Description: ${expense.description}\n` : '')
    );
  } catch (error) {
    // Creator hasn't started the bot, that's okay
  }

  await ctx.answerCallbackQuery({ text: 'Marked as paid!' });
  await ctx.editMessageText(
    `✅ Payment marked as complete!\n\n` +
    `Expense #${expense.id}\n` +
    `Amount: ${split.amount_owed.toFixed(2)}\n` +
    (expense.description ? `Description: ${expense.description}\n` : '') +
    `\nThe expense creator has been notified.`
  );
}

export async function handleCancelPayment(ctx: Context) {
  await ctx.answerCallbackQuery({ text: 'Cancelled' });
  await ctx.editMessageText('Payment marking cancelled.');
}

export async function handleViewPayments(ctx: Context, db: Database) {
  const userId = ctx.from!.id;

  let groupId: number | undefined;

  if (ctx.chat?.type !== 'private') {
    groupId = ctx.chat!.id;
    await ctx.reply('💳 I\'ll send you payment details in a DM!');
  }

  // This shows who owes you money
  // Get all expenses created by this user
  const expenses = await db.getGroupExpenses(groupId!);
  const myExpenses = expenses.filter(e => e.created_by === userId);

  let totalOwed = 0;
  let totalPaid = 0;
  const oweByPerson: { [key: number]: { name: string; amount: number; expenses: number[] } } = {};

  for (const expense of myExpenses) {
    const splits = await db.getExpenseSplits(expense.id);

    for (const split of splits) {
      if (split.user_id === userId) continue; // Skip self

      if (split.paid) {
        totalPaid += split.amount_owed;
      } else {
        totalOwed += split.amount_owed;

        if (!oweByPerson[split.user_id]) {
          const user = await db.getUser(split.user_id);
          oweByPerson[split.user_id] = {
            name: user?.first_name || user?.username || `User ${split.user_id}`,
            amount: 0,
            expenses: []
          };
        }
        oweByPerson[split.user_id].amount += split.amount_owed;
        oweByPerson[split.user_id].expenses.push(expense.id);
      }
    }
  }

  let message = '💰 Payments Owed to You:\n\n';
  message += `Total Pending: ${totalOwed.toFixed(2)}\n`;
  message += `Total Received: ${totalPaid.toFixed(2)}\n\n`;

  if (Object.keys(oweByPerson).length > 0) {
    message += '📋 Breakdown:\n';
    for (const [personId, info] of Object.entries(oweByPerson)) {
      message += `\n${info.name}:\n`;
      message += `  Amount: ${info.amount.toFixed(2)}\n`;
      message += `  Expenses: ${info.expenses.map(id => `#${id}`).join(', ')}\n`;
    }
  } else {
    message += '✅ Everyone has paid you!';
  }

  try {
    await ctx.api.sendMessage(userId, message);
  } catch (error) {
    await ctx.reply(
      '❌ I couldn\'t send you a DM. Please start a chat with me first by clicking my name and pressing "Start".'
    );
  }
}
