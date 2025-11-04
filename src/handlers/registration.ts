import { Context } from 'grammy/web';
import { Database } from '../db';
import type { Env, PaymentDetailSession } from '../types';

export async function handleRegister(ctx: Context, db: Database) {
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('This command can only be used in group chats.');
  }

  if (!ctx.message?.reply_to_message) {
    return ctx.reply(
      'Please reply to a user\'s message with /register to register them in this group.'
    );
  }

  const targetUser = ctx.message.reply_to_message.from;
  if (!targetUser) {
    return ctx.reply('Could not identify the user to register.');
  }

  const registeredBy = ctx.from!.id;
  const groupId = ctx.chat.id;

  // Create user if doesn't exist
  await db.createUser({
    telegram_id: targetUser.id,
    username: targetUser.username,
    first_name: targetUser.first_name,
    last_name: targetUser.last_name
  });

  // Register user in group
  await db.registerUserInGroup(groupId, targetUser.id, registeredBy);

  const name = targetUser.first_name || targetUser.username || 'User';
  await ctx.reply(
    `✅ ${name} has been registered in this group!`
  );
}

export async function handleSetPayment(ctx: Context, db: Database, kv: KVNamespace) {
  const userId = ctx.from!.id;

  // Start payment detail session
  const session: PaymentDetailSession = {
    step: 'info',
    payment_type: 'bank'
  };

  await kv.put(`payment_session:${userId}`, JSON.stringify(session), {
    expirationTtl: 300 // 5 minutes
  });

  await ctx.reply(
    '💳 Let\'s set up your payment details.\n\n' +
    'Please send your bank account number:'
  );
}


export async function handlePaymentInfo(ctx: Context, db: Database, kv: KVNamespace) {
  const userId = ctx.from!.id;
  const sessionKey = `payment_session:${userId}`;
  const sessionData = await kv.get(sessionKey);

  if (!sessionData) {
    return; // Not in a payment session
  }

  const session: PaymentDetailSession = JSON.parse(sessionData);

  if (session.step !== 'info' || !session.payment_type) {
    return;
  }

  const paymentInfo = ctx.message?.text;
  if (!paymentInfo) {
    return;
  }

  // Save payment details
  await db.addPaymentDetail(userId, 'bank', {
    account_number: paymentInfo
  });

  // Clear session
  await kv.delete(sessionKey);

  await ctx.reply(
    '✅ Your payment details have been saved!\n\n' +
    `Bank Account: ${paymentInfo}\n\n` +
    'You can update this anytime with /setpayment'
  );
}

export async function handleViewPayment(ctx: Context, db: Database) {
  const userId = ctx.from!.id;
  const paymentDetail = await db.getActivePaymentDetail(userId);

  if (!paymentDetail) {
    return ctx.reply(
      'You haven\'t set up payment details yet.\n\n' +
      'Use /setpayment to add your payment information.'
    );
  }

  const info = JSON.parse(paymentDetail.payment_info);
  await ctx.reply(
    '💳 Your Payment Details:\n\n' +
    `Bank Account: ${info.account_number}\n\n` +
    'Use /setpayment to update this.'
  );
}

export async function handleListUsers(ctx: Context, db: Database) {
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('This command can only be used in group chats.');
  }

  const groupId = ctx.chat.id;
  const users = await db.getGroupUsers(groupId);

  if (users.length === 0) {
    return ctx.reply(
      'No users registered yet.\n\n' +
      'Reply to a user\'s message with /register to add them.'
    );
  }

  const userList = users.map((user, idx) => {
    const name = user.first_name || user.username || `User ${user.telegram_id}`;
    return `${idx + 1}. ${name}`;
  }).join('\n');

  await ctx.reply(
    `👥 Registered Users (${users.length}):\n\n${userList}`
  );
}
