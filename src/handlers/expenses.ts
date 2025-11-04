import { Context, InlineKeyboard } from 'grammy/web';
import { Database } from '../db';
import type { Env, ExpenseSession, User } from '../types';

export async function handleAddExpense(ctx: Context, db: Database, kv: KVNamespace) {
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('This command can only be used in group chats.');
  }

  const userId = ctx.from!.id;
  const groupId = ctx.chat.id;

  // Check if user is registered
  const isRegistered = await db.isUserInGroup(groupId, userId);
  if (!isRegistered) {
    return ctx.reply(
      'You need to be registered first.\n\n' +
      'Ask someone to reply to your message with /register'
    );
  }

  // Start expense session
  const session: ExpenseSession = {
    step: 'amount'
  };

  await kv.put(`expense_session:${groupId}:${userId}`, JSON.stringify(session), {
    expirationTtl: 600 // 10 minutes
  });

  await ctx.reply(
    '💰 Let\'s add a new expense!\n\n' +
    'Step 1: Please enter the total amount (just the number):'
  );
}

export async function handleExpenseAmount(
  ctx: Context,
  db: Database,
  kv: KVNamespace,
  session: ExpenseSession,
  groupId: number,
  userId: number
) {
  const amount = parseFloat(ctx.message?.text || '');

  if (isNaN(amount) || amount <= 0) {
    return ctx.reply('Please enter a valid positive number.');
  }

  session.amount = amount;
  session.step = 'description';

  await kv.put(`expense_session:${groupId}:${userId}`, JSON.stringify(session), {
    expirationTtl: 600
  });

  const keyboard = new InlineKeyboard().text('Skip', 'expense_skip:description');

  await ctx.reply(
    `Amount: ${amount}\n\n` +
    'Step 2: Please enter a description for this expense:',
    { reply_markup: keyboard }
  );
}

export async function handleExpenseDescription(
  ctx: Context,
  db: Database,
  kv: KVNamespace,
  session: ExpenseSession,
  groupId: number,
  userId: number
) {
  session.description = ctx.message?.text;
  session.step = 'location';

  await kv.put(`expense_session:${groupId}:${userId}`, JSON.stringify(session), {
    expirationTtl: 600
  });

  const keyboard = new InlineKeyboard().text('Skip', 'expense_skip:location');

  await ctx.reply(
    'Step 3: Where was this expense? (location)',
    { reply_markup: keyboard }
  );
}

export async function handleExpenseLocation(
  ctx: Context,
  db: Database,
  kv: KVNamespace,
  session: ExpenseSession,
  groupId: number,
  userId: number
) {
  session.location = ctx.message?.text;
  session.step = 'photo';

  await kv.put(`expense_session:${groupId}:${userId}`, JSON.stringify(session), {
    expirationTtl: 600
  });

  const keyboard = new InlineKeyboard().text('Skip', 'expense_skip:photo');

  await ctx.reply(
    'Step 4: Send a photo of the bill/receipt (optional)',
    { reply_markup: keyboard }
  );
}

export async function handleExpensePhoto(
  ctx: Context,
  db: Database,
  kv: KVNamespace,
  r2: R2Bucket,
  session: ExpenseSession,
  groupId: number,
  userId: number
) {
  const photo = ctx.message?.photo;

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

    const key = `bills/${groupId}/${Date.now()}_${fileId}.jpg`;
    await r2.put(key, blob, {
      httpMetadata: {
        contentType: 'image/jpeg'
      }
    });

    session.photo_url = key;
  }

  session.step = 'users';

  await kv.put(`expense_session:${groupId}:${userId}`, JSON.stringify(session), {
    expirationTtl: 600
  });

  // Get registered users
  const users = await db.getGroupUsers(groupId);

  if (users.length === 0) {
    await kv.delete(`expense_session:${groupId}:${userId}`);
    return ctx.reply('No users registered in this group. Please register users first.');
  }

  const keyboard = new InlineKeyboard();

  // Add user selection buttons (2 per row)
  users.forEach((user, idx) => {
    const name = user.first_name || user.username || `User ${user.telegram_id}`;
    keyboard.text(`✓ ${name}`, `expense_user:${user.telegram_id}`);
    if (idx % 2 === 1) keyboard.row();
  });

  if (users.length % 2 === 1) keyboard.row();
  keyboard.text('All Users', 'expense_user:all').row();
  keyboard.text('Continue', 'expense_users_done');

  await ctx.reply(
    'Step 5: Select the users to split this expense with:\n\n' +
    '(Click users to toggle selection, then click Continue)',
    { reply_markup: keyboard }
  );
}

export async function handleUserSelection(
  ctx: Context,
  db: Database,
  kv: KVNamespace,
  userId: number,
  selectedUserId: string,
  groupId: number,
  currentUserId: number
) {
  const sessionKey = `expense_session:${groupId}:${currentUserId}`;
  const sessionData = await kv.get(sessionKey);

  if (!sessionData) {
    return ctx.answerCallbackQuery({ text: 'Session expired' });
  }

  const session: ExpenseSession = JSON.parse(sessionData);

  if (!session.selected_users) {
    session.selected_users = [];
  }

  if (selectedUserId === 'all') {
    const users = await db.getGroupUsers(groupId);
    session.selected_users = users.map(u => u.telegram_id);
  } else {
    const uid = parseInt(selectedUserId);
    const idx = session.selected_users.indexOf(uid);
    if (idx === -1) {
      session.selected_users.push(uid);
    } else {
      session.selected_users.splice(idx, 1);
    }
  }

  await kv.put(sessionKey, JSON.stringify(session), { expirationTtl: 600 });

  // Update keyboard
  const users = await db.getGroupUsers(groupId);
  const keyboard = new InlineKeyboard();

  users.forEach((user, idx) => {
    const name = user.first_name || user.username || `User ${user.telegram_id}`;
    const isSelected = session.selected_users!.includes(user.telegram_id);
    keyboard.text(
      `${isSelected ? '✓' : '○'} ${name}`,
      `expense_user:${user.telegram_id}`
    );
    if (idx % 2 === 1) keyboard.row();
  });

  if (users.length % 2 === 1) keyboard.row();
  keyboard.text('All Users', 'expense_user:all').row();
  keyboard.text('Continue', 'expense_users_done');

  await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
  await ctx.answerCallbackQuery({
    text: `${session.selected_users.length} user(s) selected`
  });
}

export async function handleUsersDone(
  ctx: Context,
  db: Database,
  kv: KVNamespace,
  groupId: number,
  userId: number
) {
  const sessionKey = `expense_session:${groupId}:${userId}`;
  const sessionData = await kv.get(sessionKey);

  if (!sessionData) {
    return ctx.answerCallbackQuery({ text: 'Session expired' });
  }

  const session: ExpenseSession = JSON.parse(sessionData);

  if (!session.selected_users || session.selected_users.length === 0) {
    return ctx.answerCallbackQuery({
      text: 'Please select at least one user',
      show_alert: true
    });
  }

  session.step = 'paid_by';
  await kv.put(sessionKey, JSON.stringify(session), { expirationTtl: 600 });

  // Get registered users to show who can be selected as payer
  const users = await db.getGroupUsers(groupId);
  const keyboard = new InlineKeyboard();

  // Add buttons for each user
  users.forEach((user, idx) => {
    const name = user.first_name || user.username || `User ${user.telegram_id}`;
    const isCurrentUser = user.telegram_id === userId;
    keyboard.text(
      isCurrentUser ? `${name} (You)` : name,
      `expense_paidby:${user.telegram_id}`
    );
    if (idx % 2 === 1) keyboard.row();
  });

  await ctx.answerCallbackQuery();
  await ctx.reply(
    `Selected ${session.selected_users.length} user(s) to split with.\n\n` +
    'Step 6: Who paid the full amount?',
    { reply_markup: keyboard }
  );
}

export async function handlePaidBy(
  ctx: Context,
  db: Database,
  kv: KVNamespace,
  paidById: number,
  groupId: number,
  userId: number
) {
  const sessionKey = `expense_session:${groupId}:${userId}`;
  const sessionData = await kv.get(sessionKey);

  if (!sessionData) {
    return ctx.answerCallbackQuery({ text: 'Session expired' });
  }

  const session: ExpenseSession = JSON.parse(sessionData);
  session.paid_by = paidById;
  session.step = 'split_type';
  await kv.put(sessionKey, JSON.stringify(session), { expirationTtl: 600 });

  const keyboard = new InlineKeyboard()
    .text('Equal Split', 'expense_split:equal').row()
    .text('Custom Split', 'expense_split:custom');

  const payer = await db.getUser(paidById);
  const payerName = payer?.first_name || payer?.username || `User ${paidById}`;

  await ctx.answerCallbackQuery();
  await ctx.reply(
    `Paid by: ${payerName}\n\n` +
    'Step 7: How should the bill be split?',
    { reply_markup: keyboard }
  );
}

export async function handleSplitType(
  ctx: Context,
  db: Database,
  kv: KVNamespace,
  r2: R2Bucket,
  splitType: 'equal' | 'custom',
  groupId: number,
  userId: number
) {
  const sessionKey = `expense_session:${groupId}:${userId}`;
  const sessionData = await kv.get(sessionKey);

  if (!sessionData) {
    return ctx.answerCallbackQuery({ text: 'Session expired' });
  }

  const session: ExpenseSession = JSON.parse(sessionData);
  session.split_type = splitType;

  await ctx.answerCallbackQuery();

  if (splitType === 'equal') {
    // Create expense immediately
    await createExpense(ctx, db, kv, r2, session, groupId, userId);
  } else {
    // Ask for custom splits
    session.step = 'custom_splits';
    session.custom_splits = {};
    await kv.put(sessionKey, JSON.stringify(session), { expirationTtl: 600 });

    const users = await db.getGroupUsers(groupId);
    // Filter out the payer from custom split entry
    const selectedUsers = users.filter(u =>
      session.selected_users!.includes(u.telegram_id) && u.telegram_id !== session.paid_by
    );

    let message = 'Please enter the amount for each person:\n\n';
    selectedUsers.forEach((user, idx) => {
      const name = user.first_name || user.username || `User ${user.telegram_id}`;
      message += `${idx + 1}. ${name} (ID: ${user.telegram_id})\n`;
    });
    message += '\nFormat: user_id amount\nExample: 123456 50.00';

    await ctx.reply(message);
  }
}

export async function handleCustomSplit(
  ctx: Context,
  db: Database,
  kv: KVNamespace,
  r2: R2Bucket,
  session: ExpenseSession,
  groupId: number,
  userId: number
) {
  const text = ctx.message?.text || '';
  const parts = text.trim().split(/\s+/);

  if (parts.length !== 2) {
    return ctx.reply('Invalid format. Use: user_id amount\nExample: 123456 50.00');
  }

  const targetUserId = parseInt(parts[0]);
  const amount = parseFloat(parts[1]);

  if (isNaN(targetUserId) || isNaN(amount) || amount <= 0) {
    return ctx.reply('Invalid values. Please enter a valid user ID and positive amount.');
  }

  if (!session.selected_users!.includes(targetUserId)) {
    return ctx.reply('This user is not in the selected users list.');
  }

  if (!session.custom_splits) {
    session.custom_splits = {};
  }

  session.custom_splits[targetUserId] = amount;

  await kv.put(`expense_session:${groupId}:${userId}`, JSON.stringify(session), {
    expirationTtl: 600
  });

  const users = await db.getGroupUsers(groupId);
  const remaining = session.selected_users!.filter(
    uid => !session.custom_splits![uid]
  );

  if (remaining.length === 0) {
    // All users have amounts, create expense
    const total = Object.values(session.custom_splits).reduce((a, b) => a + b, 0);

    if (Math.abs(total - session.amount!) > 0.01) {
      return ctx.reply(
        `⚠️ Warning: Custom splits total (${total}) doesn't match expense amount (${session.amount}).\n\n` +
        'Please re-enter the splits or use /addexpense to start over.'
      );
    }

    await createExpense(ctx, db, kv, r2, session, groupId, userId);
  } else {
    const remainingNames = remaining.map(uid => {
      const user = users.find(u => u.telegram_id === uid);
      return user?.first_name || user?.username || `User ${uid}`;
    }).join(', ');

    await ctx.reply(
      `✓ Amount set for user ${targetUserId}\n\n` +
      `Remaining users: ${remainingNames}\n\n` +
      'Continue entering amounts (user_id amount)'
    );
  }
}

async function createExpense(
  ctx: Context,
  db: Database,
  kv: KVNamespace,
  r2: R2Bucket,
  session: ExpenseSession,
  groupId: number,
  userId: number
) {
  // Create expense
  const expenseId = await db.createExpense({
    group_id: groupId,
    created_by: userId,
    paid_by: session.paid_by!,
    amount: session.amount!,
    description: session.description,
    location: session.location,
    photo_url: session.photo_url,
    split_type: session.split_type!
  });

  // Create splits - EXCLUDE the payer from splits
  const splitAmounts: { [key: number]: number } = {};
  const usersToSplit = session.selected_users!.filter(uid => uid !== session.paid_by);

  if (session.split_type === 'equal') {
    // Split equally among users EXCLUDING the payer
    const perPerson = session.amount! / usersToSplit.length;
    usersToSplit.forEach(uid => {
      splitAmounts[uid] = perPerson;
    });
  } else {
    // Custom split - only include users who aren't the payer
    Object.keys(session.custom_splits!).forEach(uidStr => {
      const uid = parseInt(uidStr);
      if (uid !== session.paid_by) {
        splitAmounts[uid] = session.custom_splits![uid];
      }
    });
  }

  // Save splits to database
  for (const [uid, amount] of Object.entries(splitAmounts)) {
    await db.createExpenseSplit(expenseId, parseInt(uid), amount);
  }

  // Clear session
  await kv.delete(`expense_session:${groupId}:${userId}`);

  // Build confirmation message
  const users = await db.getGroupUsers(groupId);
  const payer = users.find(u => u.telegram_id === session.paid_by);
  const payerName = payer?.first_name || payer?.username || `User ${session.paid_by}`;

  let message = '✅ Expense added successfully!\n\n';
  message += `💰 Total Amount: ${session.amount}\n`;
  message += `💳 Paid by: ${payerName}\n`;
  if (session.description) message += `📝 Description: ${session.description}\n`;
  if (session.location) message += `📍 Location: ${session.location}\n`;
  message += `\n👥 To be paid by ${Object.keys(splitAmounts).length} user(s):\n`;

  for (const [uid, amount] of Object.entries(splitAmounts)) {
    const user = users.find(u => u.telegram_id === parseInt(uid));
    const name = user?.first_name || user?.username || `User ${uid}`;
    message += `  • ${name}: ${amount.toFixed(2)}\n`;
  }

  message += `\nExpense ID: #${expenseId}`;

  await ctx.reply(message);

  // If there's a photo, send it
  if (session.photo_url) {
    const photoData = await r2.get(session.photo_url);
    if (photoData) {
      // Note: In a real implementation, you'd need to generate a public URL or send the binary data
      await ctx.reply('📷 Bill photo attached to expense record');
    }
  }
}

export async function handleSkip(
  ctx: Context,
  db: Database,
  kv: KVNamespace,
  r2: R2Bucket,
  field: string,
  groupId: number,
  userId: number
) {
  const sessionKey = `expense_session:${groupId}:${userId}`;
  const sessionData = await kv.get(sessionKey);

  if (!sessionData) {
    return ctx.answerCallbackQuery({ text: 'Session expired' });
  }

  const session: ExpenseSession = JSON.parse(sessionData);

  await ctx.answerCallbackQuery();

  if (field === 'description') {
    session.step = 'location';
    await kv.put(sessionKey, JSON.stringify(session), { expirationTtl: 600 });

    const keyboard = new InlineKeyboard().text('Skip', 'expense_skip:location');
    await ctx.reply('Step 3: Where was this expense? (location)', { reply_markup: keyboard });
  } else if (field === 'location') {
    session.step = 'photo';
    await kv.put(sessionKey, JSON.stringify(session), { expirationTtl: 600 });

    const keyboard = new InlineKeyboard().text('Skip', 'expense_skip:photo');
    await ctx.reply('Step 4: Send a photo of the bill/receipt (optional)', { reply_markup: keyboard });
  } else if (field === 'photo') {
    await handleExpensePhoto(ctx, db, kv, r2, session, groupId, userId);
  }
}
