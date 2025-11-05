import { Context } from 'grammy/web';
import { Database } from '../db';
import type { Env, AccountDetailSession } from '../types';
import { formatUserName, saveSession, sendDMWithFallback } from '../utils';

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

  // Prevent registering bots
  if (targetUser.is_bot) {
    return ctx.reply('*Error:* Cannot register bots.', { parse_mode: 'Markdown' });
  }

  // Check if user is already registered
  const isRegistered = await db.isUserInGroup(groupId, targetUser.id);
  if (isRegistered) {
    const user = await db.getUser(targetUser.id);
    const name = formatUserName(user, targetUser.id);
    return ctx.reply(
      `*Note:* ${name} is already registered in this group.`,
      { parse_mode: 'Markdown' }
    );
  }

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
    `*Success:* ${name} has been registered in this group!`,
    { parse_mode: 'Markdown' }
  );
}

export async function handleSetAccount(ctx: Context, db: Database, kv: KVNamespace) {
  const userId = ctx.from!.id;

  // Start account detail session
  const session: AccountDetailSession = {
    step: 'info',
    account_type: 'bank'
  };

  await saveSession(kv, `account_session:${userId}`, session, 300);

  await sendDMWithFallback(
    ctx,
    userId,
    'Let\'s set up your bank account.\n\n' +
    'Please send your bank account number:'
  );
}


export async function handleAccountInfo(ctx: Context, db: Database, kv: KVNamespace) {
  const userId = ctx.from!.id;
  const sessionKey = `account_session:${userId}`;
  const sessionData = await kv.get(sessionKey);

  if (!sessionData) {
    return; // Not in an account session
  }

  const session: AccountDetailSession = JSON.parse(sessionData);

  if (session.step !== 'info' || !session.account_type) {
    return;
  }

  const accountInfo = ctx.message?.text;
  if (!accountInfo) {
    return;
  }

  // Save account details
  await db.addAccountDetail(userId, 'bank', {
    account_number: accountInfo
  });

  // Clear session
  await kv.delete(sessionKey);

  await sendDMWithFallback(
    ctx,
    userId,
    '*Success:* Your bank account has been saved!\n\n' +
    `Bank Account: \`${accountInfo}\`\n\n` +
    'You can update this anytime with /setaccount'
  );
}

export async function handleViewAccount(ctx: Context, db: Database) {
  const userId = ctx.from!.id;
  const accountDetail = await db.getActiveAccountDetail(userId);

  if (!accountDetail) {
    return sendDMWithFallback(
      ctx,
      userId,
      'You haven\'t set up your bank account yet.\n\n' +
      'Use /setaccount to add your bank account.'
    );
  }

  const info = JSON.parse(accountDetail.account_info);
  await sendDMWithFallback(
    ctx,
    userId,
    '*Your Bank Account:*\n\n' +
    `Account Number: \`${info.account_number}\`\n\n` +
    'Use /setaccount to update this.'
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
    `*Registered Users (${users.length}):*\n\n${userList}`,
    { parse_mode: 'Markdown' }
  );
}

export async function handleGroupAccountInfo(ctx: Context, db: Database) {
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

  let message = '*Bank Account Information:*\n\n';

  for (const user of users) {
    const name = formatUserName(user);
    const accountDetail = await db.getActiveAccountDetail(user.telegram_id);

    if (accountDetail) {
      const info = JSON.parse(accountDetail.account_info);
      message += `${name} - \`${info.account_number}\`\n`;
    } else {
      message += `${name} - _No account set_\n`;
    }
  }

  message += '\nUse /setaccount to set your bank account';

  await ctx.reply(message, { parse_mode: 'Markdown' });
}

export async function handleUnregister(ctx: Context, db: Database) {
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('This command can only be used in group chats.');
  }

  // Check if user is admin
  const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from!.id);
  if (member.status !== 'creator' && member.status !== 'administrator') {
    return ctx.reply('*Error:* Only group admins can unregister users.', { parse_mode: 'Markdown' });
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
      return ctx.reply('*Error:* Could not identify the user to unregister.', { parse_mode: 'Markdown' });
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
        '*Error:* Please either:\n' +
        '• Reply to the user\'s message with /unregister\n' +
        '• Use /unregister @username\n' +
        '• Use /unregister username',
        { parse_mode: 'Markdown' }
      );
    }

    const username = parts[1].replace('@', ''); // Remove @ if present

    // Get all registered users in the group to find the user by username
    const groupUsers = await db.getGroupUsers(groupId);
    const targetUser = groupUsers.find(u => u.username?.toLowerCase() === username.toLowerCase());

    if (!targetUser) {
      return ctx.reply(`*Error:* User @${username} is not registered in this group.`, { parse_mode: 'Markdown' });
    }

    targetUserId = targetUser.telegram_id;
    targetUsername = targetUser.username;
    targetFirstName = targetUser.first_name;
    targetLastName = targetUser.last_name;
  }

  // Check if user is registered
  const isRegistered = await db.isUserInGroup(groupId, targetUserId);
  if (!isRegistered) {
    return ctx.reply('*Error:* This user is not registered in this group.', { parse_mode: 'Markdown' });
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

    await ctx.reply(`*Success:* ${targetName} has been unregistered from this group.`, { parse_mode: 'Markdown' });
  } else {
    await ctx.reply(`*Error:* ${result.message}`, { parse_mode: 'Markdown' });
  }
}
