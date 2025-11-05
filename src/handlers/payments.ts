import { Context, InlineKeyboard } from 'grammy/web';
import { Database } from '../db';
import { formatUserName, formatAmount, saveSession, sendDMWithFallback } from '../utils';

export async function handleMarkPaid(ctx: Context, db: Database) {
  const userId = ctx.from!.id;

  let groupId: number | undefined;

  if (ctx.chat?.type !== 'private') {
    groupId = ctx.chat!.id;
  }

  // Get user's unpaid splits
  const unpaidSplits = await db.getUserUnpaidSplits(userId, groupId);

  if (unpaidSplits.length === 0) {
    return ctx.reply('*Great news:* You have no pending expenses to mark as paid!', { parse_mode: 'Markdown' });
  }

  // Create inline keyboard with expenses
  const keyboard = new InlineKeyboard();

  for (const split of unpaidSplits.slice(0, 10)) { // Show max 10 at a time
    const expense = split.expense;
    const label = `#${expense.id} - ${formatAmount(split.amount_owed)}${expense.description ? ` (${expense.description.substring(0, 20)})` : ''}`;
    keyboard.text(label, `markpaid:${split.id}`).row();
  }

  let message = '*Select an expense to mark as paid:*\n\n';

  if (unpaidSplits.length > 10) {
    message += `Showing 10 of ${unpaidSplits.length} pending expenses.\n`;
    message += 'Use /myexpenses to see all.\n\n';
  }

  await ctx.reply(message, { reply_markup: keyboard, parse_mode: 'Markdown' });
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

  // Get payer's payment details (person who paid the full amount)
  const payerPayment = await db.getActivePaymentDetail(expense.paid_by);

  if (!payerPayment) {
    await ctx.answerCallbackQuery();
    return ctx.reply(
      '*Warning:* The person who paid this expense hasn\'t set up payment details yet.\n' +
      'Ask them to use /setpayment to add their payment information.',
      { parse_mode: 'Markdown' }
    );
  }

  const paymentInfo = JSON.parse(payerPayment.payment_info);
  const payer = await db.getUser(expense.paid_by);
  const payerName = formatUserName(payer, expense.paid_by);

  let message = `*Payment Details for Expense #${expense.id}:*\n\n`;
  message += `Amount to pay: ${formatAmount(split.amount_owed)}\n`;
  if (expense.description) message += `For: ${expense.description}\n`;
  message += `\nPay to: ${payerName}\n`;
  message += `Bank Account: ${paymentInfo.account_number}\n\n`;
  message += `Once you've paid, click the button below to mark as paid.`;

  const keyboard = new InlineKeyboard()
    .text('I\'ve Paid This', `confirmpaid:${splitId}`)
    .row()
    .text('Cancel', 'cancel_payment');

  await ctx.answerCallbackQuery();
  await ctx.reply(message, { reply_markup: keyboard, parse_mode: 'Markdown' });
}

export async function handleConfirmPaid(
  ctx: Context,
  db: Database,
  kv: KVNamespace,
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

  // Create payment session
  const session = {
    split_id: splitId,
    step: 'photo'
  };

  await saveSession(kv, `payment_session:${userId}`, session);

  const keyboard = new InlineKeyboard()
    .text('Skip', `payment_skip:${splitId}`);

  await ctx.answerCallbackQuery();
  await ctx.reply(
    '*Transfer Slip:* Would you like to upload a bank transfer slip as proof of payment?\n\n' +
    'You can send a photo now, or click Skip to mark as paid without a receipt.',
    { reply_markup: keyboard, parse_mode: 'Markdown' }
  );
}

export async function handlePaymentPhoto(
  ctx: Context,
  db: Database,
  kv: KVNamespace,
  r2: R2Bucket,
  userId: number
) {
  const sessionData = await kv.get(`payment_session:${userId}`);

  if (!sessionData) {
    return; // No active payment session
  }

  const session = JSON.parse(sessionData);
  const splitId = session.split_id;

  // Get split info
  const splits = await db.getUserUnpaidSplits(userId);
  const split = splits.find(s => s.id === splitId);

  if (!split) {
    await kv.delete(`payment_session:${userId}`);
    return ctx.reply('Expense not found or already paid.');
  }

  const expense = split.expense;
  const photo = ctx.message?.photo;

  let transferSlipUrl: string | undefined;

  if (photo && photo.length > 0) {
    // Get the largest photo
    const largestPhoto = photo[photo.length - 1];
    const fileId = largestPhoto.file_id;

    // Get file from Telegram
    const file = await ctx.api.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;

    // Download and upload to R2
    const response = await fetch(fileUrl);
    const blob = await response.arrayBuffer();

    const key = `transfer_slips/${userId}/${Date.now()}_${fileId}.jpg`;
    await r2.put(key, blob, {
      httpMetadata: {
        contentType: 'image/jpeg'
      }
    });

    transferSlipUrl = key;
  }

  // Complete the payment
  await completePayment(ctx, db, kv, splitId, userId, transferSlipUrl);
}

export async function handlePaymentSkip(
  ctx: Context,
  db: Database,
  kv: KVNamespace,
  splitId: number
) {
  const userId = ctx.from!.id;
  await ctx.answerCallbackQuery();
  await completePayment(ctx, db, kv, splitId, userId);
}

async function completePayment(
  ctx: Context,
  db: Database,
  kv: KVNamespace,
  splitId: number,
  userId: number,
  transferSlipUrl?: string
) {
  // Verify ownership
  const splits = await db.getUserUnpaidSplits(userId);
  const split = splits.find(s => s.id === splitId);

  if (!split) {
    await kv.delete(`payment_session:${userId}`);
    return ctx.reply('Expense not found or already paid.');
  }

  const expense = split.expense;

  // Mark as paid
  await db.markSplitAsPaid(splitId);

  // Record payment transaction with optional transfer slip
  await db.recordPayment(
    splitId,
    userId,
    expense.paid_by,
    split.amount_owed,
    transferSlipUrl
  );

  // Clear session
  await kv.delete(`payment_session:${userId}`);

  // Notify the person who paid the expense
  const payingUser = await db.getUser(userId);
  const payingUserName = formatUserName(payingUser, userId);

  try {
    let notificationMsg = `*Success:* ${payingUserName} marked their payment as paid!\n\n` +
      `Expense #${expense.id}\n` +
      `Amount: ${formatAmount(split.amount_owed)}\n` +
      (expense.description ? `Description: ${expense.description}\n` : '');

    if (transferSlipUrl) {
      notificationMsg += '\n*Transfer slip attached*';
    }

    await ctx.api.sendMessage(expense.paid_by, notificationMsg, { parse_mode: 'Markdown' });
  } catch (error) {
    // Payer hasn't started the bot, that's okay
  }

  await ctx.reply(
    `*Success:* Payment marked as complete!\n\n` +
    `Expense #${expense.id}\n` +
    `Amount: ${split.amount_owed.toFixed(2)}\n` +
    (expense.description ? `Description: ${expense.description}\n` : '') +
    (transferSlipUrl ? '\n*Transfer slip uploaded*' : '') +
    `\n\nThe person who paid has been notified.`,
    { parse_mode: 'Markdown' }
  );
}

export async function handleCancelPayment(ctx: Context) {
  await ctx.answerCallbackQuery({ text: 'Cancelled' });
  await ctx.editMessageText('Payment marking cancelled.');
}

export async function handleAdminMarkPaid(ctx: Context, db: Database) {
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('This command can only be used in group chats.');
  }

  // Check if user is admin
  const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from!.id);
  if (member.status !== 'creator' && member.status !== 'administrator') {
    return ctx.reply('*Error:* Only group admins can mark payments on behalf of users.', { parse_mode: 'Markdown' });
  }

  // Check if replying to a message
  if (!ctx.message?.reply_to_message) {
    return ctx.reply(
      '*Error:* Please reply to the user\'s message whose payment you want to mark as paid with /adminmarkpaid',
      { parse_mode: 'Markdown' }
    );
  }

  const targetUser = ctx.message.reply_to_message.from;
  if (!targetUser) {
    return ctx.reply('*Error:* Could not identify the user.', { parse_mode: 'Markdown' });
  }

  const groupId = ctx.chat.id;
  const targetUserId = targetUser.id;

  // Get target user's unpaid splits in this group
  const unpaidSplits = await db.getUserUnpaidSplits(targetUserId, groupId);

  if (unpaidSplits.length === 0) {
    const targetName = formatUserName({
      telegram_id: targetUserId,
      username: targetUser.username,
      first_name: targetUser.first_name,
      last_name: targetUser.last_name,
      created_at: Date.now()
    }, targetUserId);

    return ctx.reply(`*Great news:* ${targetName} has no pending expenses to mark as paid!`, { parse_mode: 'Markdown' });
  }

  // Create inline keyboard with expenses
  const keyboard = new InlineKeyboard();

  for (const split of unpaidSplits.slice(0, 10)) { // Show max 10 at a time
    const expense = split.expense;
    const label = `#${expense.id} - ${formatAmount(split.amount_owed)}${expense.description ? ` (${expense.description.substring(0, 20)})` : ''}`;
    keyboard.text(label, `adminmarkpaid:${split.id}:${targetUserId}`).row();
  }

  let message = `*Select an expense to mark as paid for ${targetUser.first_name}:*\n\n`;

  if (unpaidSplits.length > 10) {
    message += `Showing 10 of ${unpaidSplits.length} pending expenses.\n`;
  }

  await ctx.reply(message, { reply_markup: keyboard, parse_mode: 'Markdown' });
}

export async function handleAdminMarkPaidCallback(
  ctx: Context,
  db: Database,
  splitId: number,
  targetUserId: number
) {
  // Check if user is admin
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.answerCallbackQuery({ text: 'This can only be used in groups', show_alert: true });
  }

  const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from!.id);
  if (member.status !== 'creator' && member.status !== 'administrator') {
    return ctx.answerCallbackQuery({ text: 'Only admins can do this', show_alert: true });
  }

  // Get the split to verify it belongs to the target user
  const splits = await db.getUserUnpaidSplits(targetUserId);
  const split = splits.find(s => s.id === splitId);

  if (!split) {
    return ctx.answerCallbackQuery({
      text: 'Expense not found or already paid',
      show_alert: true
    });
  }

  const expense = split.expense;
  const targetUser = await db.getUser(targetUserId);
  const targetName = formatUserName(targetUser, targetUserId);

  // Mark as paid
  await db.markSplitAsPaid(splitId);

  // Record payment transaction (admin is marking it, but payment is from targetUser to expense.paid_by)
  await db.recordPayment(
    splitId,
    targetUserId,
    expense.paid_by,
    split.amount_owed
  );

  await ctx.answerCallbackQuery();

  // Notify the person who paid the expense
  try {
    const adminUser = await db.getUser(ctx.from!.id);
    const adminName = formatUserName(adminUser, ctx.from!.id);

    let notificationMsg = `*Success:* Admin ${adminName} marked ${targetName}'s payment as paid!\n\n` +
      `Expense #${expense.id}\n` +
      `Amount: ${formatAmount(split.amount_owed)}\n` +
      (expense.description ? `Description: ${expense.description}\n` : '');

    await ctx.api.sendMessage(expense.paid_by, notificationMsg, { parse_mode: 'Markdown' });
  } catch (error) {
    // Payer hasn't started the bot, that's okay
  }

  // Notify the user whose payment was marked
  try {
    let userNotificationMsg = `*Success:* Admin marked your payment as complete!\n\n` +
      `Expense #${expense.id}\n` +
      `Amount: ${formatAmount(split.amount_owed)}\n` +
      (expense.description ? `Description: ${expense.description}\n` : '');

    await ctx.api.sendMessage(targetUserId, userNotificationMsg, { parse_mode: 'Markdown' });
  } catch (error) {
    // User hasn't started the bot, that's okay
  }

  await ctx.reply(
    `*Success:* Payment marked as complete for ${targetName}!\n\n` +
    `Expense #${expense.id}\n` +
    `Amount: ${formatAmount(split.amount_owed)}\n` +
    (expense.description ? `Description: ${expense.description}` : ''),
    { parse_mode: 'Markdown' }
  );
}

export async function handleViewPayments(ctx: Context, db: Database) {
  const userId = ctx.from!.id;

  let groupId: number | undefined;

  if (ctx.chat?.type !== 'private') {
    groupId = ctx.chat!.id;
    await ctx.reply('*Note:* I\'ll send you payment details in a DM!', { parse_mode: 'Markdown' });
  }

  // This shows who owes you money
  // Get all expenses paid by this user (where you fronted the money)
  const expenses = await db.getGroupExpenses(groupId!);
  const myExpenses = expenses.filter(e => e.paid_by === userId);

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
            name: formatUserName(user, split.user_id),
            amount: 0,
            expenses: []
          };
        }
        oweByPerson[split.user_id].amount += split.amount_owed;
        oweByPerson[split.user_id].expenses.push(expense.id);
      }
    }
  }

  let message = '*Payments Owed to You:*\n\n';
  message += `Total Pending: ${formatAmount(totalOwed)}\n`;
  message += `Total Received: ${formatAmount(totalPaid)}\n\n`;

  if (Object.keys(oweByPerson).length > 0) {
    message += '*Breakdown:*\n';
    for (const [personId, info] of Object.entries(oweByPerson)) {
      message += `\n${info.name}:\n`;
      message += `  Amount: ${formatAmount(info.amount)}\n`;
      message += `  Expenses: ${info.expenses.map(id => `#${id}`).join(', ')}\n`;
    }
  } else {
    message += '*Great news:* Everyone has paid you!';
  }

  await sendDMWithFallback(ctx, userId, message);
}
