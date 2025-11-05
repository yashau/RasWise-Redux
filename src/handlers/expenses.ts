import { Context, InlineKeyboard } from 'grammy/web';
import { Database } from '../db';
import type { Env, ExpenseSession, User } from '../types';
import { formatUserName, formatAmount, saveSession, getSession } from '../utils';

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

  // Start expense session with groupId stored
  const session: ExpenseSession = {
    step: 'amount',
    group_id: groupId
  };

  const sessionKey = `expense_session:${userId}`;
  await saveSession(kv, sessionKey, session);

  // Send initial prompt to DM
  try {
    await ctx.api.sendMessage(
      userId,
      'Let\'s add a new expense!\n\n' +
      'Step 1: Please enter the total amount (just the number):'
    );
  } catch (error) {
    await ctx.reply(
      '*Error:* I couldn\'t send you a DM. Please start a chat with me first by clicking my name and pressing "Start".',
      { parse_mode: 'Markdown' }
    );
  }
}

export async function handleExpenseAmount(
  ctx: Context,
  db: Database,
  kv: KVNamespace,
  session: ExpenseSession,
  groupId: number,
  userId: number
) {
  try {
    const amount = parseFloat(ctx.message?.text || '');

    if (isNaN(amount) || amount <= 0) {
      return ctx.reply('Please enter a valid positive number.');
    }

    session.amount = amount;
    session.step = 'description';

    await saveSession(kv, `expense_session:${userId}`, session);

    const keyboard = new InlineKeyboard().text('Skip', 'expense_skip:description');

    await ctx.reply(
      `Amount: ${amount}\n\n` +
      'Step 2: Please enter a description for this expense:',
      { reply_markup: keyboard }
    );
  } catch (error) {
    console.error('Error in handleExpenseAmount:', error);
    await ctx.reply('An error occurred. Please try again with /addexpense');
  }
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

  await saveSession(kv, `expense_session:${userId}`, session);

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

  await saveSession(kv, `expense_session:${userId}`, session);

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
  console.log(`[R2 PHOTO] User ${userId}, has photo: ${!!photo}, photo count: ${photo?.length || 0}`);

  if (photo && photo.length > 0) {
    try {
      // Get the largest photo
      const largestPhoto = photo[photo.length - 1];
      const fileId = largestPhoto.file_id;
      console.log(`[R2 PHOTO] File ID: ${fileId}, Size: ${largestPhoto.file_size}`);

      // Get file from Telegram
      const file = await ctx.api.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
      console.log(`[R2 PHOTO] File path: ${file.file_path}, URL length: ${fileUrl.length}`);

      // Download and upload to R2
      const response = await fetch(fileUrl);
      console.log(`[R2 PHOTO] Fetch response status: ${response.status}`);

      const blob = await response.arrayBuffer();
      console.log(`[R2 PHOTO] Downloaded blob size: ${blob.byteLength} bytes`);

      const key = `bills/${groupId}/${Date.now()}_${fileId}.jpg`;
      console.log(`[R2 PHOTO] Uploading to R2 with key: ${key}`);

      await r2.put(key, blob, {
        httpMetadata: {
          contentType: 'image/jpeg'
        }
      });
      console.log(`[R2 PHOTO] Successfully uploaded to R2`);

      session.photo_url = key;
    } catch (error) {
      console.error(`[R2 PHOTO ERROR]`, error);
      await ctx.reply('*Warning:* Error uploading photo. Continuing without it.', { parse_mode: 'Markdown' });
    }
  }

  session.step = 'vendor_slip';

  await saveSession(kv, `expense_session:${userId}`, session);

  const keyboard = new InlineKeyboard().text('Skip', 'expense_skip:vendor_slip');

  await ctx.reply(
    'Step 5: Send a photo of your payment slip to the vendor (bank transfer receipt, etc.)\n\n' +
    '(Optional - this is proof that you paid the vendor/restaurant)',
    { reply_markup: keyboard }
  );
}

export async function handleVendorSlipPhoto(
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

    const key = `vendor_slips/${groupId}/${Date.now()}_${fileId}.jpg`;
    await r2.put(key, blob, {
      httpMetadata: {
        contentType: 'image/jpeg'
      }
    });

    session.vendor_payment_slip_url = key;
  }

  session.step = 'users';

  await saveSession(kv, `expense_session:${userId}`, session);

  // Get registered users
  const users = await db.getGroupUsers(groupId);

  if (users.length === 0) {
    await kv.delete(`expense_session:${userId}`);
    return ctx.reply('No users registered in this group. Please register users first.');
  }

  const keyboard = new InlineKeyboard();

  // Add user selection buttons (2 per row)
  users.forEach((user, idx) => {
    const name = formatUserName(user);
    keyboard.text(`✓ ${name}`, `expense_user:${user.telegram_id}`);
    if (idx % 2 === 1) keyboard.row();
  });

  if (users.length % 2 === 1) keyboard.row();
  keyboard.text('All Users', 'expense_user:all').row();
  keyboard.text('Continue', 'expense_users_done');

  await ctx.reply(
    'Step 6: Select the users to split this expense with:\n\n' +
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
  const sessionKey = `expense_session:${currentUserId}`;
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

  await saveSession(kv, sessionKey, session);

  // Update keyboard
  const users = await db.getGroupUsers(groupId);
  const keyboard = new InlineKeyboard();

  users.forEach((user, idx) => {
    const name = formatUserName(user);
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

  try {
    await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
  } catch (error) {
    // Ignore error if message is not modified (same selection)
    console.log('Message not modified, continuing...');
  }

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
  const sessionKey = `expense_session:${userId}`;
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
  await saveSession(kv, sessionKey, session);

  // Get registered users to show who can be selected as payer
  const users = await db.getGroupUsers(groupId);
  const keyboard = new InlineKeyboard();

  // Add buttons for each user
  users.forEach((user, idx) => {
    const name = formatUserName(user);
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
    'Step 7: Who paid the full amount?',
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
  const sessionKey = `expense_session:${userId}`;
  const sessionData = await kv.get(sessionKey);

  if (!sessionData) {
    return ctx.answerCallbackQuery({ text: 'Session expired' });
  }

  const session: ExpenseSession = JSON.parse(sessionData);
  session.paid_by = paidById;
  session.step = 'split_type';
  await saveSession(kv, sessionKey, session);

  const keyboard = new InlineKeyboard()
    .text('Equal Split', 'expense_split:equal').row()
    .text('Custom Split', 'expense_split:custom');

  const payer = await db.getUser(paidById);
  const payerName = formatUserName(payer, paidById);

  await ctx.answerCallbackQuery();
  await ctx.reply(
    `Paid by: ${payerName}\n\n` +
    'Step 8: How should the bill be split?',
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
  userId: number,
  r2PublicUrl: string
) {
  const sessionKey = `expense_session:${userId}`;
  const sessionData = await kv.get(sessionKey);

  if (!sessionData) {
    return ctx.answerCallbackQuery({ text: 'Session expired' });
  }

  const session: ExpenseSession = JSON.parse(sessionData);
  session.split_type = splitType;

  await ctx.answerCallbackQuery();

  if (splitType === 'equal') {
    // Create expense immediately
    await createExpense(ctx, db, kv, r2, session, groupId, userId, r2PublicUrl);
  } else {
    // Ask for custom splits
    session.step = 'custom_splits';
    session.custom_splits = {};
    await saveSession(kv, sessionKey, session);

    const users = await db.getGroupUsers(groupId);
    // Filter out the payer from custom split entry
    const selectedUsers = users.filter(u =>
      session.selected_users!.includes(u.telegram_id) && u.telegram_id !== session.paid_by
    );

    let message = 'Please enter the amount for each person:\n\n';
    selectedUsers.forEach((user, idx) => {
      const name = formatUserName(user);
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
  userId: number,
  r2PublicUrl: string
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

  await saveSession(kv, `expense_session:${userId}`, session);

  const users = await db.getGroupUsers(groupId);
  const remaining = session.selected_users!.filter(
    uid => !session.custom_splits![uid]
  );

  if (remaining.length === 0) {
    // All users have amounts, create expense
    const total = Object.values(session.custom_splits).reduce((a, b) => a + b, 0);

    if (Math.abs(total - session.amount!) > 0.01) {
      return ctx.reply(
        `*Warning:* Custom splits total (${total}) doesn't match expense amount (${session.amount}).\n\n` +
        'Please re-enter the splits or use /addexpense to start over.',
        { parse_mode: 'Markdown' }
      );
    }

    await createExpense(ctx, db, kv, r2, session, groupId, userId, r2PublicUrl);
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
  userId: number,
  r2PublicUrl: string
) {
  // Create expense
  const expense = await db.createExpense({
    group_id: groupId,
    created_by: userId,
    paid_by: session.paid_by!,
    amount: session.amount!,
    description: session.description,
    location: session.location,
    photo_url: session.photo_url,
    vendor_payment_slip_url: session.vendor_payment_slip_url,
    split_type: session.split_type!
  });

  const expenseId = expense.id;
  const groupExpenseNumber = expense.group_expense_number;

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
  await kv.delete(`expense_session:${userId}`);

  // Build confirmation message
  const users = await db.getGroupUsers(groupId);
  const payer = users.find(u => u.telegram_id === session.paid_by);
  const payerName = formatUserName(payer, session.paid_by);

  let message = '*Success:* Expense added successfully!\n\n';
  message += `*Total Amount:* ${session.amount}\n`;
  message += `*Paid by:* ${payerName}\n`;
  if (session.description) message += `*Description:* ${session.description}\n`;
  if (session.location) message += `*Location:* ${session.location}\n`;
  message += `\n*To be paid by ${Object.keys(splitAmounts).length} user(s):*\n`;

  for (const [uid, amount] of Object.entries(splitAmounts)) {
    const user = users.find(u => u.telegram_id === parseInt(uid));
    const name = user?.first_name || user?.username || `User ${uid}`;
    message += `  • ${name}: ${formatAmount(amount)}\n`;
  }

  message += `\nExpense ID: #${groupExpenseNumber}`;

  // Send confirmation to DM
  await ctx.reply(message, { parse_mode: 'Markdown' });

  // Also send summary to the group
  let groupMessage = `*Success:* New expense added by ${formatUserName(users.find(u => u.telegram_id === userId), userId)}\n\n`;
  groupMessage += `*Amount:* ${formatAmount(session.amount!)}\n`;
  if (session.description) groupMessage += `*Description:* ${session.description}\n`;
  if (session.location) groupMessage += `*Location:* ${session.location}\n`;
  if (session.photo_url) groupMessage += `*Bill photo:* [View](${getPublicPhotoUrl(session.photo_url, r2PublicUrl)})\n`;
  if (session.vendor_payment_slip_url) groupMessage += `*Vendor slip:* [View](${getPublicPhotoUrl(session.vendor_payment_slip_url, r2PublicUrl)})\n`;
  groupMessage += `*Paid by:* ${payerName}\n`;
  groupMessage += `*Split among:* ${Object.keys(splitAmounts).length} user(s)\n`;
  groupMessage += `\nExpense ID: #${groupExpenseNumber}`;

  await ctx.api.sendMessage(groupId, groupMessage, { parse_mode: 'Markdown' });

  // If there's a photo, send it
  if (session.photo_url) {
    const photoData = await r2.get(session.photo_url);
    if (photoData) {
      // Note: In a real implementation, you'd need to generate a public URL or send the binary data
      await ctx.reply('*Note:* Bill photo attached to expense record', { parse_mode: 'Markdown' });
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
  const sessionKey = `expense_session:${userId}`;
  const sessionData = await kv.get(sessionKey);

  if (!sessionData) {
    return ctx.answerCallbackQuery({ text: 'Session expired' });
  }

  const session: ExpenseSession = JSON.parse(sessionData);

  await ctx.answerCallbackQuery();

  if (field === 'description') {
    session.step = 'location';
    await saveSession(kv, sessionKey, session);

    const keyboard = new InlineKeyboard().text('Skip', 'expense_skip:location');
    await ctx.reply('Step 3: Where was this expense? (location)', { reply_markup: keyboard });
  } else if (field === 'location') {
    session.step = 'photo';
    await saveSession(kv, sessionKey, session);

    const keyboard = new InlineKeyboard().text('Skip', 'expense_skip:photo');
    await ctx.reply('Step 4: Send a photo of the bill/receipt (optional)', { reply_markup: keyboard });
  } else if (field === 'photo') {
    await handleExpensePhoto(ctx, db, kv, r2, session, groupId, userId);
  } else if (field === 'vendor_slip') {
    await handleVendorSlipPhoto(ctx, db, kv, r2, session, groupId, userId);
  }
}
