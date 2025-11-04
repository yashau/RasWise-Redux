import { Context } from 'grammy/web';
import { Database } from '../db';
import type { Env, PaymentDetailSession } from '../types';
import { formatUserName, saveSession } from '../utils';

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

  // Get the user from DB to use formatUserName properly
  const user = await db.getUser(targetUser.id);
  const name = formatUserName(user, targetUser.id);
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

  await saveSession(kv, `payment_session:${userId}`, session, 300);

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
    const name = formatUserName(user);
    return `${idx + 1}. ${name}`;
  }).join('\n');

  await ctx.reply(
    `👥 Registered Users (${users.length}):\n\n${userList}`
  );
}

export async function handleUnregister(ctx: Context, db: Database) {
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('This command can only be used in group chats.');
  }

  // Check if user is admin
  const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from!.id);
  if (member.status !== 'creator' && member.status !== 'administrator') {
    return ctx.reply('❌ Only group admins can unregister users.');
  }

  const groupId = ctx.chat.id;
  let targetUserId: number | undefined;
  let targetUsername: string | undefined;
  let targetFirstName: string | undefined;
  let targetLastName: string | undefined;

  // Check if replying to a message
  if (ctx.message?.reply_to_message) {
    const targetUser = ctx.message.reply_to_message.from;
    if (!targetUser) {
      return ctx.reply('❌ Could not identify the user to unregister.');
    }
    targetUserId = targetUser.id;
    targetUsername = targetUser.username;
    targetFirstName = targetUser.first_name;
    targetLastName = targetUser.last_name;
  } else {
    // Check for @username or plain username in command text
    const text = ctx.message?.text || '';
    const parts = text.split(/\s+/);

    if (parts.length < 2) {
      return ctx.reply(
        '❌ Please either:\n' +
        '• Reply to the user\'s message with /unregister\n' +
        '• Use /unregister @username\n' +
        '• Use /unregister username'
      );
    }

    const username = parts[1].replace('@', ''); // Remove @ if present

    // Get all registered users in the group to find the user by username
    const groupUsers = await db.getGroupUsers(groupId);
    const targetUser = groupUsers.find(u => u.username?.toLowerCase() === username.toLowerCase());

    if (!targetUser) {
      return ctx.reply(`❌ User @${username} is not registered in this group.`);
    }

    targetUserId = targetUser.telegram_id;
    targetUsername = targetUser.username;
    targetFirstName = targetUser.first_name;
    targetLastName = targetUser.last_name;
  }

  // Check if user is registered
  const isRegistered = await db.isUserInGroup(groupId, targetUserId);
  if (!isRegistered) {
    return ctx.reply('❌ This user is not registered in this group.');
  }

  // Attempt to unregister
  const result = await db.unregisterUserFromGroup(groupId, targetUserId);

  if (result.success) {
    const targetName = formatUserName({
      telegram_id: targetUserId,
      username: targetUsername,
      first_name: targetFirstName,
      last_name: targetLastName,
      created_at: Date.now()
    }, targetUserId);

    await ctx.reply(`✅ ${targetName} has been unregistered from this group.`);
  } else {
    await ctx.reply(`❌ ${result.message}`);
  }
}
