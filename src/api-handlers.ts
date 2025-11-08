import { Database } from './db';
import { validateTelegramWebAppData } from './telegram-auth';
import { escapeMarkdown } from './utils';
import type { Env } from './types';

/**
 * API Handlers for Mini App endpoints
 */

// Helper function to get group title from any registered user's memberships
async function getGroupTitleFromMemberships(db: Database, groupId: number, fallbackUserId: number): Promise<string | undefined> {
  // Get group info from any registered user's memberships (same logic as /api/group-users)
  const groupUsers = await db.getGroupUsers(groupId);
  const memberships = await db.getUserGroups(groupUsers[0]?.telegram_id || fallbackUserId);
  const groupInfo = memberships.find(m => m.group_id === groupId);
  return groupInfo?.group_title;
}

export async function handleGetUserGroups(request: Request, env: Env): Promise<Response> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const validation = await validateTelegramWebAppData(initData, env.BOT_TOKEN);

  if (!validation.valid) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const userId = validation.user?.id;
  if (!userId) {
    return jsonResponse({ error: 'Missing user_id' }, 400);
  }

  const db = new Database(env.DB);
  const groups = await db.getUserGroups(userId);

  // Group titles are populated by middleware when users send messages in groups
  return jsonResponse({ groups });
}

export async function handleGetGroupUsers(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const groupId = url.searchParams.get('group_id');

  if (!groupId) {
    return jsonResponse({ error: 'Missing group_id' }, 400);
  }

  const db = new Database(env.DB);
  const users = await db.getGroupUsers(parseInt(groupId));

  // Get group info
  const memberships = await db.getUserGroups(users[0]?.telegram_id || 0);
  const groupInfo = memberships.find(m => m.group_id === parseInt(groupId));

  return jsonResponse({
    users,
    group_title: groupInfo?.group_title,
    group_username: groupInfo?.group_username
  });
}

export async function handleGetUnpaidExpenses(request: Request, env: Env): Promise<Response> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const validation = await validateTelegramWebAppData(initData, env.BOT_TOKEN);

  if (!validation.valid) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const groupId = url.searchParams.get('group_id');
  const userId = validation.user?.id;

  if (!groupId || !userId) {
    return jsonResponse({ error: 'Missing parameters' }, 400);
  }

  const db = new Database(env.DB);
  const expenses = await db.getUserUnpaidSplits(userId, parseInt(groupId));

  // Get group title using helper
  const groupTitle = await getGroupTitleFromMemberships(db, parseInt(groupId), userId);

  // Get currency
  const currency = await db.getGroupCurrency(parseInt(groupId));

  return jsonResponse({
    expenses,
    group_title: groupTitle,
    currency: currency || '$'
  });
}

export async function handleGetUserExpenses(request: Request, env: Env): Promise<Response> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const validation = await validateTelegramWebAppData(initData, env.BOT_TOKEN);

  if (!validation.valid) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const groupId = url.searchParams.get('group_id');
  const userId = validation.user?.id;

  if (!groupId || !userId) {
    return jsonResponse({ error: 'Missing parameters' }, 400);
  }

  const db = new Database(env.DB);

  // Get all splits (paid and unpaid) where user owes money
  const allSplits = await env.DB.prepare(`
    SELECT
      es.id,
      es.expense_id,
      es.user_id,
      es.amount_owed,
      es.paid,
      es.paid_at,
      e.id as expense_id,
      e.group_id,
      e.group_expense_number,
      e.created_by,
      e.paid_by,
      e.amount,
      e.description,
      e.location,
      e.photo_url,
      e.vendor_payment_slip_url,
      e.split_type,
      e.created_at,
      p.transfer_slip_url
    FROM expense_splits es
    JOIN expenses e ON es.expense_id = e.id
    LEFT JOIN payments p ON p.expense_split_id = es.id
    WHERE es.user_id = ? AND e.group_id = ?
    ORDER BY e.created_at DESC
  `).bind(userId, parseInt(groupId)).all<any>();

  // Get expenses where user is the payer (to show what they paid for)
  // For these, we need to fetch all transfer slips from people who paid them back
  const paidExpenses = await env.DB.prepare(`
    SELECT
      e.id,
      e.group_id,
      e.group_expense_number,
      e.created_by,
      e.paid_by,
      e.amount,
      e.description,
      e.location,
      e.photo_url,
      e.vendor_payment_slip_url,
      e.split_type,
      e.created_at,
      NULL as split_id,
      NULL as user_id,
      NULL as amount_owed,
      1 as paid,
      e.created_at as paid_at,
      NULL as transfer_slip_url
    FROM expenses e
    WHERE e.paid_by = ? AND e.group_id = ?
    ORDER BY e.created_at DESC
  `).bind(userId, parseInt(groupId)).all<any>();

  // For expenses where user is the payer, get all transfer slips from splits
  const getTransferSlipsForExpense = async (expenseId: number): Promise<string[]> => {
    const slipsResult = await env.DB.prepare(`
      SELECT p.transfer_slip_url
      FROM payments p
      JOIN expense_splits es ON p.expense_split_id = es.id
      WHERE es.expense_id = ? AND p.transfer_slip_url IS NOT NULL
    `).bind(expenseId).all<{ transfer_slip_url: string }>();

    return (slipsResult.results || []).map(row => `${env.R2_PUBLIC_URL}/${row.transfer_slip_url}`);
  };

  // Combine splits and expenses where user paid
  const expenses = await Promise.all([
    ...(allSplits.results || []).map(async (row: any) => ({
      id: row.id,
      expense_id: row.expense_id,
      user_id: row.user_id,
      amount_owed: row.amount_owed,
      paid: row.paid,
      paid_at: row.paid_at,
      transfer_slip_url: row.transfer_slip_url ? `${env.R2_PUBLIC_URL}/${row.transfer_slip_url}` : null,
      expense: {
        id: row.expense_id,
        group_id: row.group_id,
        created_by: row.created_by,
        paid_by: row.paid_by,
        amount: row.amount,
        description: row.description,
        location: row.location,
        photo_url: row.photo_url ? `${env.R2_PUBLIC_URL}/${row.photo_url}` : null,
        vendor_payment_slip_url: row.vendor_payment_slip_url ? `${env.R2_PUBLIC_URL}/${row.vendor_payment_slip_url}` : null,
        split_type: row.split_type,
        created_at: row.created_at,
        group_expense_number: row.group_expense_number
      }
    })),
    ...(paidExpenses.results || []).map(async (row: any) => {
      // Get all transfer slips for expenses where user is the payer
      const allTransferSlips = await getTransferSlipsForExpense(row.id);

      return {
        id: row.split_id, // This is null for expenses user paid
        expense_id: row.id,
        user_id: userId,
        amount_owed: row.amount, // Show full amount they paid
        paid: 1,
        paid_at: row.created_at,
        transfer_slip_url: null,
        all_transfer_slips: allTransferSlips, // Array of all transfer slips from people who paid back
        is_payer: true, // Flag to indicate this is an expense they paid for
        expense: {
          id: row.id,
          group_id: row.group_id,
          created_by: row.created_by,
          paid_by: row.paid_by,
          amount: row.amount,
          description: row.description,
          location: row.location,
          photo_url: row.photo_url ? `${env.R2_PUBLIC_URL}/${row.photo_url}` : null,
          vendor_payment_slip_url: row.vendor_payment_slip_url ? `${env.R2_PUBLIC_URL}/${row.vendor_payment_slip_url}` : null,
          split_type: row.split_type,
          created_at: row.created_at,
          group_expense_number: row.group_expense_number
        }
      };
    })
  ]);

  // Sort by created_at descending
  expenses.sort((a, b) => b.expense.created_at - a.expense.created_at);

  // Remove duplicates (if user is both payer and has a split)
  // Prioritize keeping the "is_payer" version over split versions
  const uniqueExpenses = expenses.filter((exp, index, self) => {
    const firstIndex = self.findIndex((e) => e.expense_id === exp.expense_id);
    if (firstIndex === index) return true; // Keep if it's the first occurrence

    // If this is not the first occurrence, only keep it if it's the payer version
    // and the first occurrence is not the payer version
    const firstExp = self[firstIndex];
    return exp.is_payer && !firstExp.is_payer;
  });

  // Get group info
  const groups = await db.getUserGroups(userId);
  const groupInfo = groups.find(g => g.group_id === parseInt(groupId));

  // Get currency
  const currency = await db.getGroupCurrency(parseInt(groupId));

  return jsonResponse({
    expenses: uniqueExpenses,
    group_title: groupInfo?.group_title,
    currency: currency || '$'
  });
}

export async function handleGetSummary(request: Request, env: Env): Promise<Response> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const validation = await validateTelegramWebAppData(initData, env.BOT_TOKEN);

  if (!validation.valid) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const groupId = url.searchParams.get('group_id');
  const userId = validation.user?.id;

  if (!groupId || !userId) {
    return jsonResponse({ error: 'Missing parameters' }, 400);
  }

  const db = new Database(env.DB);
  const summary = await db.getUserSummary(userId, parseInt(groupId));

  // Get group info
  const groups = await db.getUserGroups(userId);
  const groupInfo = groups.find(g => g.group_id === parseInt(groupId));

  // Get currency
  const currency = await db.getGroupCurrency(parseInt(groupId));

  return jsonResponse({
    summary,
    group_title: groupInfo?.group_title,
    currency: currency || '$'
  });
}

export async function handleGetHistory(request: Request, env: Env): Promise<Response> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const validation = await validateTelegramWebAppData(initData, env.BOT_TOKEN);

  if (!validation.valid) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const groupId = url.searchParams.get('group_id');

  if (!groupId) {
    return jsonResponse({ error: 'Missing group_id' }, 400);
  }

  const userId = validation.user?.id;
  if (!userId) {
    return jsonResponse({ error: 'Missing user_id' }, 400);
  }

  const db = new Database(env.DB);
  const expenses = await db.getGroupExpenses(parseInt(groupId), 100);

  // Get group info
  const groups = await db.getUserGroups(userId);
  const groupInfo = groups.find(g => g.group_id === parseInt(groupId));

  // Check if user is admin
  const isAdmin = await isUserGroupAdmin(env.BOT_TOKEN, parseInt(groupId), userId);

  // Helper to get all transfer slips for an expense
  const getTransferSlipsForExpenseHistory = async (expenseId: number): Promise<string[]> => {
    const slipsResult = await env.DB.prepare(`
      SELECT p.transfer_slip_url
      FROM payments p
      JOIN expense_splits es ON p.expense_split_id = es.id
      WHERE es.expense_id = ? AND p.transfer_slip_url IS NOT NULL
    `).bind(expenseId).all<{ transfer_slip_url: string }>();

    return (slipsResult.results || []).map(row => `${env.R2_PUBLIC_URL}/${row.transfer_slip_url}`);
  };

  // Enrich expenses with user information, full photo URLs, and completeness status
  const { formatUserName } = await import('./utils');
  const enrichedExpenses = await Promise.all(
    expenses.map(async (expense) => {
      const paidByUser = await db.getUser(expense.paid_by);
      const splits = await db.getExpenseSplits(expense.id);

      // An expense is complete if all splits are paid
      const isComplete = splits.length === 0 || splits.every(split => split.paid === 1);

      // Get all transfer slips for this expense
      const allTransferSlips = await getTransferSlipsForExpenseHistory(expense.id);

      return {
        ...expense,
        paid_by_name: formatUserName(paidByUser, expense.paid_by),
        photo_url: expense.photo_url ? `${env.R2_PUBLIC_URL}/${expense.photo_url}` : null,
        vendor_payment_slip_url: expense.vendor_payment_slip_url ? `${env.R2_PUBLIC_URL}/${expense.vendor_payment_slip_url}` : null,
        is_complete: isComplete,
        all_transfer_slips: allTransferSlips
      };
    })
  );

  // Get currency
  const currency = await db.getGroupCurrency(parseInt(groupId));

  return jsonResponse({
    expenses: enrichedExpenses,
    group_title: groupInfo?.group_title,
    is_admin: isAdmin,
    currency: currency || '$'
  });
}

export async function handleGetOwed(request: Request, env: Env): Promise<Response> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const validation = await validateTelegramWebAppData(initData, env.BOT_TOKEN);

  if (!validation.valid) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const groupId = url.searchParams.get('group_id');
  const userId = validation.user?.id;

  if (!groupId || !userId) {
    return jsonResponse({ error: 'Missing parameters' }, 400);
  }

  const db = new Database(env.DB);

  // Get expenses where user paid
  const expenses = await db.getGroupExpenses(parseInt(groupId), 100);
  const owedData: any[] = [];

  for (const expense of expenses) {
    if (expense.paid_by === userId) {
      const splits = await db.getExpenseSplits(expense.id);
      for (const split of splits) {
        if (split.user_id !== userId && split.paid === 0) {
          const user = await db.getUser(split.user_id);
          owedData.push({
            expense: {
              ...expense,
              photo_url: expense.photo_url ? `${env.R2_PUBLIC_URL}/${expense.photo_url}` : null,
              vendor_payment_slip_url: expense.vendor_payment_slip_url ? `${env.R2_PUBLIC_URL}/${expense.vendor_payment_slip_url}` : null
            },
            split,
            user
          });
        }
      }
    }
  }

  // Get group info
  const groups = await db.getUserGroups(userId);
  const groupInfo = groups.find(g => g.group_id === parseInt(groupId));

  // Get currency
  const currency = await db.getGroupCurrency(parseInt(groupId));

  return jsonResponse({
    owed: owedData,
    group_title: groupInfo?.group_title,
    currency: currency || '$'
  });
}

export async function handleAddExpense(request: Request, env: Env): Promise<Response> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const validation = await validateTelegramWebAppData(initData, env.BOT_TOKEN);

  if (!validation.valid) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const userId = validation.user?.id;
  if (!userId) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const formData = await request.formData();

    const groupId = parseInt(formData.get('group_id') as string);
    const amount = parseFloat(formData.get('amount') as string);
    const description = formData.get('description') as string || '';
    const location = formData.get('location') as string || '';
    const paidBy = parseInt(formData.get('paid_by') as string);
    const splitType = formData.get('split_type') as 'equal' | 'custom';
    const selectedUsers = JSON.parse(formData.get('selected_users') as string);

    const billPhoto = formData.get('bill_photo') as File | null;
    const vendorSlip = formData.get('vendor_slip') as File | null;

    // Upload photos if present
    let photoUrl: string | undefined;
    let vendorSlipUrl: string | undefined;

    if (billPhoto && billPhoto.size > 0) {
      const filename = `${Date.now()}_${userId}_bill.jpg`;
      await env.BILLS_BUCKET.put(filename, billPhoto, {
        httpMetadata: { contentType: billPhoto.type }
      });
      photoUrl = filename; // Store relative path only
    }

    if (vendorSlip && vendorSlip.size > 0) {
      const filename = `${Date.now()}_${userId}_vendor.jpg`;
      await env.BILLS_BUCKET.put(filename, vendorSlip, {
        httpMetadata: { contentType: vendorSlip.type }
      });
      vendorSlipUrl = filename; // Store relative path only
    }

    // Create expense
    const db = new Database(env.DB);
    const expense = await db.createExpense({
      group_id: groupId,
      created_by: userId,
      paid_by: paidBy,
      amount,
      description,
      location,
      photo_url: photoUrl,
      vendor_payment_slip_url: vendorSlipUrl,
      split_type: splitType
    });

    // Create splits - exclude the payer from splits since they already paid
    const usersWhoOwe = selectedUsers.filter((uid: number) => uid !== paidBy);
    const splitAmounts: { [userId: number]: number } = {};

    if (splitType === 'equal') {
      // Split equally among ALL selected users (including payer for calculation)
      // But only create split records for users who aren't the payer
      const amountPerPerson = amount / selectedUsers.length;
      for (const selectedUserId of usersWhoOwe) {
        await db.createExpenseSplit(expense.id, selectedUserId, amountPerPerson);
        splitAmounts[selectedUserId] = amountPerPerson;
      }
    } else {
      const customSplits = JSON.parse(formData.get('custom_splits') as string);
      for (const selectedUserId of usersWhoOwe) {
        const splitAmount = customSplits[selectedUserId] || 0;
        await db.createExpenseSplit(expense.id, selectedUserId, splitAmount);
        splitAmounts[selectedUserId] = splitAmount;
      }
    }

    // Send DM notifications if webhook domain is configured
    if (env.WEBHOOK_DOMAIN && env.BOT_USERNAME) {
      try {
        // Get group currency
        const currency = await db.getGroupCurrency(groupId);

        // Get group name
        const groupUsers = await db.getGroupUsers(groupId);
        let groupName = 'Unknown Group';
        if (groupUsers.length > 0) {
          const memberships = await db.getUserGroups(groupUsers[0].telegram_id);
          const groupInfo = memberships.find(m => m.group_id === groupId);
          groupName = groupInfo?.group_title || `Group ${groupId}`;
        }

        // Get payer info
        const payerUser = await db.getUser(paidBy);
        const payerName = payerUser
          ? `${payerUser.first_name}${payerUser.last_name ? ' ' + payerUser.last_name : ''}`
          : `User ${paidBy}`;

        // Send DM to each user who owes money with deep link to pay page
        for (const [uid, splitAmount] of Object.entries(splitAmounts)) {
          const targetUserId = parseInt(uid);
          const dmMessage = `💰 *New Expense Alert*\n` +
            `Group: ${escapeMarkdown(groupName)}\n\n` +
            `You owe *${currency} ${splitAmount.toFixed(2)}* to ${escapeMarkdown(payerName)}\n` +
            (description ? `Description: ${escapeMarkdown(description)}\n` : '') +
            (location ? `Location: ${escapeMarkdown(location)}\n` : '') +
            `Expense ID: #${expense.group_expense_number}\n\n` +
            `👉 Tap to pay: https://t.me/${env.BOT_USERNAME.replace(/_/g, '\\_')}/app?startapp=pay-${groupId}`;

          try {
            const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: targetUserId,
                text: dmMessage,
                parse_mode: 'Markdown',
                disable_web_page_preview: false
              })
            });
            const result = await response.json();
            if (!result.ok) {
              console.log(`Could not send DM to user ${targetUserId}:`, result);
            }
          } catch (error) {
            console.log(`Could not send DM to user ${targetUserId}:`, error);
          }
        }

        // Send notification to the group with expense details
        if (Object.keys(splitAmounts).length > 0) {
          // Get payer info
          const payerName = payerUser
            ? `${payerUser.first_name}${payerUser.last_name ? ' ' + payerUser.last_name : ''}`
            : `User ${paidBy}`;

          // Build list of users who owe money
          let owedList = '';
          for (const [uid, splitAmount] of Object.entries(splitAmounts)) {
            const targetUserId = parseInt(uid);
            const targetUser = await db.getUser(targetUserId);
            const targetUserName = targetUser
              ? `${targetUser.first_name}${targetUser.last_name ? ' ' + targetUser.last_name : ''}`
              : `User ${targetUserId}`;
            owedList += `• ${escapeMarkdown(targetUserName)}: ${currency} ${splitAmount.toFixed(2)}\n`;
          }

          let groupMessage = `📊 *New Expense Created*\n\n` +
            `*Total Amount:* ${currency} ${amount.toFixed(2)}\n` +
            `*Paid By:* ${escapeMarkdown(payerName)}\n` +
            (description ? `*Description:* ${escapeMarkdown(description)}\n` : '') +
            (location ? `*Location:* ${escapeMarkdown(location)}\n` : '') +
            `*Expense ID:* #${expense.group_expense_number}\n\n` +
            `*Amount Owed:*\n${owedList}`;

          // Add photo links if they exist
          if (photoUrl || vendorSlipUrl) {
            groupMessage += '\n';
            if (photoUrl) {
              groupMessage += `\n📸 [Bill Photo](${env.R2_PUBLIC_URL}/${photoUrl})`;
            }
            if (vendorSlipUrl) {
              groupMessage += `\n🧾 [Vendor Payment Slip](${env.R2_PUBLIC_URL}/${vendorSlipUrl})`;
            }
          }

          try {
            // Send message to group
            await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: groupId,
                text: groupMessage,
                parse_mode: 'Markdown',
                disable_web_page_preview: false
              })
            });
          } catch (error) {
            console.log(`Could not send notification to group ${groupId}:`, error);
          }
        }
      } catch (error) {
        console.error('Error sending notifications:', error);
        // Don't fail the expense creation if notifications fail
      }
    }

    return jsonResponse({ success: true, expense_id: expense.id });
  } catch (error) {
    console.error('Error adding expense:', error);
    return jsonResponse({ error: 'Failed to add expense' }, 500);
  }
}

export async function handleMarkPaid(request: Request, env: Env): Promise<Response> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const validation = await validateTelegramWebAppData(initData, env.BOT_TOKEN);

  if (!validation.valid) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const userId = validation.user?.id;
  if (!userId) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const formData = await request.formData();

    const splitId = parseInt(formData.get('split_id') as string);
    const paidTo = parseInt(formData.get('paid_to') as string);
    const transferSlip = formData.get('transfer_slip') as File | null;

    if (isNaN(splitId) || isNaN(paidTo)) {
      return jsonResponse({ error: 'Invalid split_id or paid_to' }, 400);
    }

    // Get split to get amount
    const db = new Database(env.DB);
    const split = await db.getExpenseSplit(splitId);

    if (!split) {
      return jsonResponse({ error: `Split not found (ID: ${splitId})` }, 404);
    }

    // Verify the split belongs to the user
    if (split.user_id !== userId) {
      return jsonResponse({ error: 'You can only mark your own expenses as paid' }, 403);
    }

    // Check if already paid
    if (split.paid === 1) {
      return jsonResponse({ error: 'This expense has already been marked as paid' }, 400);
    }

    // Upload transfer slip if present
    let transferSlipUrl: string | undefined;
    if (transferSlip && transferSlip.size > 0) {
      const filename = `${Date.now()}_${userId}_transfer.jpg`;
      await env.BILLS_BUCKET.put(filename, transferSlip, {
        httpMetadata: { contentType: transferSlip.type }
      });
      transferSlipUrl = filename; // Store relative path only
    }

    // Mark split as paid
    await db.markSplitAsPaid(splitId);

    // Record payment
    await db.recordPayment(splitId, userId, paidTo, split.amount_owed, transferSlipUrl);

    // Get expense info for notifications
    const expense = await db.getExpense(split.expense_id);

    // Send DM notification to the person who was paid if webhook domain is configured
    if (env.WEBHOOK_DOMAIN && env.BOT_USERNAME && expense) {
      try {
        // Get group currency
        const currency = await db.getGroupCurrency(expense.group_id);

        // Get group name
        const groupUsers = await db.getGroupUsers(expense.group_id);
        let groupName = 'Unknown Group';
        if (groupUsers.length > 0) {
          const memberships = await db.getUserGroups(groupUsers[0].telegram_id);
          const groupInfo = memberships.find(m => m.group_id === expense.group_id);
          groupName = groupInfo?.group_title || `Group ${expense.group_id}`;
        }

        // Get paying user info
        const payingUser = await db.getUser(userId);
        const payingUserName = payingUser
          ? `${payingUser.first_name}${payingUser.last_name ? ' ' + payingUser.last_name : ''}`
          : `User ${userId}`;

        let notificationMsg = `💰 *Payment Received*\n` +
          `Group: ${escapeMarkdown(groupName)}\n\n` +
          `${escapeMarkdown(payingUserName)} marked their payment as paid!\n` +
          `Amount: *${currency} ${split.amount_owed.toFixed(2)}*\n` +
          `Expense #${expense.id}\n` +
          (expense.description ? `Description: ${escapeMarkdown(expense.description)}\n` : '') +
          (expense.location ? `Location: ${escapeMarkdown(expense.location)}\n` : '');

        if (transferSlipUrl) {
          notificationMsg += '\n*Transfer slip attached*';
        }

        notificationMsg += `\n\n👉 Tap to pay: https://t.me/${env.BOT_USERNAME.replace(/_/g, '\\_')}/app?startapp=myexpenses-${expense.group_id}`;

        try {
          await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: paidTo,
              text: notificationMsg,
              parse_mode: 'Markdown',
              disable_web_page_preview: false
            })
          });
        } catch (error) {
          console.log(`Could not send DM to payer ${paidTo}:`, error);
        }
      } catch (error) {
        console.error('Error sending notification:', error);
        // Don't fail the operation if notification fails
      }
    }

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Error marking paid:', error);
    return jsonResponse({ error: 'Failed to mark as paid' }, 500);
  }
}

export async function handleDeleteExpense(request: Request, env: Env): Promise<Response> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const validation = await validateTelegramWebAppData(initData, env.BOT_TOKEN);

  if (!validation.valid) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const userId = validation.user?.id;
  if (!userId) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await request.json() as any;
    const expenseId = parseInt(body.expense_id);
    const groupId = parseInt(body.group_id);

    if (!expenseId || !groupId) {
      return jsonResponse({ error: 'Missing expense_id or group_id' }, 400);
    }

    // Check if user is admin
    const isAdmin = await isUserGroupAdmin(env.BOT_TOKEN, groupId, userId);
    if (!isAdmin) {
      return jsonResponse({ error: 'Only group admins can delete expenses' }, 403);
    }

    const db = new Database(env.DB);

    // Get the expense to get photo URLs
    const expense = await db.getExpense(expenseId);
    if (!expense) {
      return jsonResponse({ error: 'Expense not found' }, 404);
    }

    // Get all splits to get transfer slip URLs
    const splits = await db.getExpenseSplits(expenseId);

    // Delete photos from R2
    const photosToDelete: string[] = [];
    if (expense.photo_url) photosToDelete.push(expense.photo_url);
    if (expense.vendor_payment_slip_url) photosToDelete.push(expense.vendor_payment_slip_url);

    // Get transfer slip URLs from payments
    for (const split of splits) {
      const payment = await env.DB.prepare(`
        SELECT transfer_slip_url FROM payments WHERE expense_split_id = ?
      `).bind(split.id).first<{ transfer_slip_url: string | null }>();

      if (payment?.transfer_slip_url) {
        photosToDelete.push(payment.transfer_slip_url);
      }
    }

    // Delete from R2
    for (const photoUrl of photosToDelete) {
      try {
        // Extract filename from URL - handle both relative paths and full URLs for backward compatibility
        let filename = photoUrl;
        if (photoUrl.startsWith('http://') || photoUrl.startsWith('https://')) {
          // Old format: full URL - extract just the path
          filename = photoUrl.replace(`${env.R2_PUBLIC_URL}/`, '');
        }
        // New format: already just the path/filename
        await env.BILLS_BUCKET.delete(filename);
      } catch (err) {
        console.error('Error deleting photo:', photoUrl, err);
      }
    }

    // Delete payments first (foreign key constraint)
    await env.DB.prepare(`
      DELETE FROM payments WHERE expense_split_id IN (
        SELECT id FROM expense_splits WHERE expense_id = ?
      )
    `).bind(expenseId).run();

    // Delete expense splits
    await env.DB.prepare(`
      DELETE FROM expense_splits WHERE expense_id = ?
    `).bind(expenseId).run();

    // Delete the expense
    await env.DB.prepare(`
      DELETE FROM expenses WHERE id = ?
    `).bind(expenseId).run();

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Error deleting expense:', error);
    return jsonResponse({ error: 'Failed to delete expense' }, 500);
  }
}

// Helper functions
async function isUserGroupAdmin(botToken: string, groupId: number, userId: number): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: groupId,
        user_id: userId
      })
    });

    const data = await response.json() as any;
    if (data.ok && data.result) {
      const status = data.result.status;
      return status === 'creator' || status === 'administrator';
    }
    return false;
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

export async function handleGetAccountInfo(request: Request, env: Env): Promise<Response> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const validation = await validateTelegramWebAppData(initData, env.BOT_TOKEN);

  if (!validation.valid) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const userId = validation.user?.id;
  if (!userId) {
    return jsonResponse({ error: 'Missing user_id' }, 400);
  }

  const db = new Database(env.DB);
  const accountDetail = await db.getActiveAccountDetail(userId);

  if (!accountDetail) {
    return jsonResponse({ has_account: false });
  }

  const info = JSON.parse(accountDetail.account_info);
  return jsonResponse({
    has_account: true,
    account_type: accountDetail.account_type,
    account_number: info.account_number
  });
}

export async function handleSetAccountInfo(request: Request, env: Env): Promise<Response> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const validation = await validateTelegramWebAppData(initData, env.BOT_TOKEN);

  if (!validation.valid) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const userId = validation.user?.id;
  if (!userId) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await request.json() as any;
    const accountNumber = body.account_number;

    if (!accountNumber) {
      return jsonResponse({ error: 'Missing account_number' }, 400);
    }

    const db = new Database(env.DB);
    await db.addAccountDetail(userId, 'bank', { account_number: accountNumber });

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Error setting account:', error);
    return jsonResponse({ error: 'Failed to set account' }, 500);
  }
}

export async function handleGetGroupAccountInfo(request: Request, env: Env): Promise<Response> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const validation = await validateTelegramWebAppData(initData, env.BOT_TOKEN);

  if (!validation.valid) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const groupId = url.searchParams.get('group_id');

  if (!groupId) {
    return jsonResponse({ error: 'Missing group_id' }, 400);
  }

  const db = new Database(env.DB);
  const users = await db.getGroupUsers(parseInt(groupId));

  const { formatUserName } = await import('./utils');
  const usersWithAccounts = await Promise.all(
    users.map(async (user) => {
      const accountDetail = await db.getActiveAccountDetail(user.telegram_id);
      let accountNumber = null;

      if (accountDetail) {
        const info = JSON.parse(accountDetail.account_info);
        accountNumber = info.account_number;
      }

      return {
        telegram_id: user.telegram_id,
        name: formatUserName(user, user.telegram_id),
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        account_number: accountNumber
      };
    })
  );

  return jsonResponse({ users: usersWithAccounts });
}

export async function handleGetGroupSettings(request: Request, env: Env): Promise<Response> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const validation = await validateTelegramWebAppData(initData, env.BOT_TOKEN);

  if (!validation.valid) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const groupId = url.searchParams.get('group_id');
  const userId = validation.user?.id;

  if (!groupId || !userId) {
    return jsonResponse({ error: 'Missing parameters' }, 400);
  }

  const db = new Database(env.DB);

  // Check if user is admin
  const isAdmin = await isUserGroupAdmin(env.BOT_TOKEN, parseInt(groupId), userId);

  // Get reminder settings
  const reminderSettings = await db.getReminderSettings(parseInt(groupId));

  // Get timezone
  const timezone = await db.getGroupTimezone(parseInt(groupId));

  // Get currency
  const currency = await db.getGroupCurrency(parseInt(groupId));

  return jsonResponse({
    is_admin: isAdmin,
    reminders_enabled: reminderSettings?.enabled || false,
    last_reminder_sent: reminderSettings?.last_reminder_sent || null,
    timezone: timezone || 0,
    currency: currency || '$'
  });
}

export async function handleUpdateReminderSettings(request: Request, env: Env): Promise<Response> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const validation = await validateTelegramWebAppData(initData, env.BOT_TOKEN);

  if (!validation.valid) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const userId = validation.user?.id;
  if (!userId) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await request.json() as any;
    const groupId = parseInt(body.group_id);
    const enabled = body.enabled;

    if (!groupId || enabled === undefined) {
      return jsonResponse({ error: 'Missing parameters' }, 400);
    }

    // Check if user is admin
    const isAdmin = await isUserGroupAdmin(env.BOT_TOKEN, groupId, userId);
    if (!isAdmin) {
      return jsonResponse({ error: 'Only group admins can change reminder settings' }, 403);
    }

    const db = new Database(env.DB);

    // Get current settings to preserve reminder_time
    const currentSettings = await db.getReminderSettings(groupId);
    const reminderTime = currentSettings?.reminder_time || '10:00';

    await db.setReminderSettings(groupId, enabled, reminderTime);

    return jsonResponse({ success: true, enabled });
  } catch (error) {
    console.error('Error updating reminder settings:', error);
    return jsonResponse({ error: 'Failed to update reminder settings' }, 500);
  }
}

export async function handleUpdateTimezone(request: Request, env: Env): Promise<Response> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const validation = await validateTelegramWebAppData(initData, env.BOT_TOKEN);

  if (!validation.valid) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const userId = validation.user?.id;
  if (!userId) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await request.json() as any;
    const groupId = parseInt(body.group_id);
    const timezone = parseInt(body.timezone);

    if (!groupId || timezone === undefined || timezone < -12 || timezone > 14) {
      return jsonResponse({ error: 'Invalid parameters' }, 400);
    }

    // Check if user is admin
    const isAdmin = await isUserGroupAdmin(env.BOT_TOKEN, groupId, userId);
    if (!isAdmin) {
      return jsonResponse({ error: 'Only group admins can change timezone settings' }, 403);
    }

    const db = new Database(env.DB);
    await db.setGroupTimezone(groupId, timezone);

    return jsonResponse({ success: true, timezone });
  } catch (error) {
    console.error('Error updating timezone:', error);
    return jsonResponse({ error: 'Failed to update timezone' }, 500);
  }
}

export async function handleUpdateCurrency(request: Request, env: Env): Promise<Response> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const validation = await validateTelegramWebAppData(initData, env.BOT_TOKEN);

  if (!validation.valid) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const userId = validation.user?.id;
  if (!userId) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await request.json() as any;
    const groupId = parseInt(body.group_id);
    const currency = body.currency;

    if (!groupId || !currency) {
      return jsonResponse({ error: 'Invalid parameters' }, 400);
    }

    // Check if user is admin
    const isAdmin = await isUserGroupAdmin(env.BOT_TOKEN, groupId, userId);
    if (!isAdmin) {
      return jsonResponse({ error: 'Only group admins can change currency settings' }, 403);
    }

    const db = new Database(env.DB);
    await db.setGroupCurrency(groupId, currency);

    return jsonResponse({ success: true, currency });
  } catch (error) {
    console.error('Error updating currency:', error);
    return jsonResponse({ error: 'Failed to update currency' }, 500);
  }
}

export async function handleUnregisterUser(request: Request, env: Env): Promise<Response> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const validation = await validateTelegramWebAppData(initData, env.BOT_TOKEN);

  if (!validation.valid) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const userId = validation.user?.id;
  if (!userId) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await request.json() as any;
    const groupId = parseInt(body.group_id);
    const targetUserId = parseInt(body.target_user_id);

    if (!groupId || !targetUserId) {
      return jsonResponse({ error: 'Missing parameters' }, 400);
    }

    // Check if user is admin
    const isAdmin = await isUserGroupAdmin(env.BOT_TOKEN, groupId, userId);
    if (!isAdmin) {
      return jsonResponse({ error: 'Only group admins can unregister users' }, 403);
    }

    const db = new Database(env.DB);
    const result = await db.unregisterUserFromGroup(groupId, targetUserId);

    if (result.success) {
      return jsonResponse({ success: true });
    } else {
      return jsonResponse({ error: result.message }, 400);
    }
  } catch (error) {
    console.error('Error unregistering user:', error);
    return jsonResponse({ error: 'Failed to unregister user' }, 500);
  }
}

export async function handleGetUnpaidSplits(request: Request, env: Env): Promise<Response> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const validation = await validateTelegramWebAppData(initData, env.BOT_TOKEN);

  if (!validation.valid) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const userId = validation.user?.id;
  if (!userId) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const groupId = parseInt(url.searchParams.get('group_id') || '');

  if (!groupId) {
    return jsonResponse({ error: 'Missing group_id' }, 400);
  }

  // Check if user is admin
  const isAdmin = await isUserGroupAdmin(env.BOT_TOKEN, groupId, userId);
  if (!isAdmin) {
    return jsonResponse({ error: 'Only group admins can view unpaid splits' }, 403);
  }

  try {
    const db = new Database(env.DB);

    // Get all unpaid splits for this group
    const result = await env.DB.prepare(`
      SELECT
        es.id as split_id,
        es.user_id,
        es.amount_owed,
        e.id as expense_id,
        e.group_expense_number,
        e.amount as expense_amount,
        e.description,
        e.created_at,
        u.first_name,
        u.last_name,
        u.username,
        paid_by_user.first_name as paid_by_first_name,
        paid_by_user.last_name as paid_by_last_name,
        paid_by_user.username as paid_by_username
      FROM expense_splits es
      JOIN expenses e ON es.expense_id = e.id
      JOIN users u ON es.user_id = u.telegram_id
      JOIN users paid_by_user ON e.paid_by = paid_by_user.telegram_id
      WHERE e.group_id = ? AND es.paid = 0
      ORDER BY e.created_at DESC
    `).bind(groupId).all();

    const splits = result.results.map((row: any) => ({
      split_id: row.split_id,
      user_id: row.user_id,
      amount_owed: row.amount_owed,
      expense: {
        id: row.expense_id,
        group_expense_number: row.group_expense_number,
        amount: row.expense_amount,
        description: row.description,
        created_at: row.created_at,
        paid_by_name: formatUserNameFromRow(row, 'paid_by_')
      },
      user_name: formatUserNameFromRow(row, '')
    }));

    // Get currency
    const currency = await db.getGroupCurrency(groupId);

    return jsonResponse({
      splits,
      currency: currency || '$'
    });
  } catch (error) {
    console.error('Error getting unpaid splits:', error);
    return jsonResponse({ error: 'Failed to get unpaid splits' }, 500);
  }
}

function formatUserNameFromRow(row: any, prefix: string): string {
  const firstName = row[`${prefix}first_name`];
  const lastName = row[`${prefix}last_name`];
  const username = row[`${prefix}username`];

  if (firstName && lastName) {
    return `${firstName} ${lastName}`;
  }
  if (firstName) {
    return firstName;
  }
  if (username) {
    return `@${username}`;
  }
  return 'Unknown User';
}

export async function handleAdminMarkPaid(request: Request, env: Env): Promise<Response> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const validation = await validateTelegramWebAppData(initData, env.BOT_TOKEN);

  if (!validation.valid) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const userId = validation.user?.id;
  if (!userId) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const formData = await request.formData();

    const groupId = parseInt(formData.get('group_id') as string);
    const splitId = parseInt(formData.get('split_id') as string);
    const targetUserId = parseInt(formData.get('target_user_id') as string);
    const transferSlip = formData.get('transfer_slip') as File | null;

    if (!groupId || !splitId || !targetUserId) {
      return jsonResponse({ error: 'Missing parameters' }, 400);
    }

    // Check if user is admin
    const isAdmin = await isUserGroupAdmin(env.BOT_TOKEN, groupId, userId);
    if (!isAdmin) {
      return jsonResponse({ error: 'Only group admins can mark payments on behalf of users' }, 403);
    }

    // Get split to get amount and expense details
    const db = new Database(env.DB);
    const split = await db.getExpenseSplit(splitId);

    if (!split) {
      return jsonResponse({ error: 'Split not found' }, 404);
    }

    // Get expense to find who was paid
    const expense = await db.getExpense(split.expense_id);
    if (!expense) {
      return jsonResponse({ error: 'Expense not found' }, 404);
    }

    // Upload transfer slip if present
    let transferSlipUrl: string | undefined;
    if (transferSlip && transferSlip.size > 0) {
      const filename = `${Date.now()}_${targetUserId}_admin_transfer.jpg`;
      await env.BILLS_BUCKET.put(filename, transferSlip, {
        httpMetadata: { contentType: transferSlip.type }
      });
      transferSlipUrl = filename; // Store relative path only
    }

    // Mark split as paid
    await db.markSplitAsPaid(splitId);

    // Record payment - paid by target user to the person who paid the expense
    await db.recordPayment(splitId, targetUserId, expense.paid_by, split.amount_owed, transferSlipUrl);

    // Send DM notifications if webhook domain is configured
    if (env.WEBHOOK_DOMAIN && env.BOT_USERNAME) {
      try {
        // Get group currency
        const currency = await db.getGroupCurrency(groupId);

        // Get group name
        const groupUsers = await db.getGroupUsers(groupId);
        let groupName = 'Unknown Group';
        if (groupUsers.length > 0) {
          const memberships = await db.getUserGroups(groupUsers[0].telegram_id);
          const groupInfo = memberships.find(m => m.group_id === groupId);
          groupName = groupInfo?.group_title || `Group ${groupId}`;
        }

        // Get admin info
        const adminUser = await db.getUser(userId);
        const adminName = adminUser
          ? `${adminUser.first_name}${adminUser.last_name ? ' ' + adminUser.last_name : ''}`
          : `User ${userId}`;

        // Get target user info
        const targetUser = await db.getUser(targetUserId);
        const targetName = targetUser
          ? `${targetUser.first_name}${targetUser.last_name ? ' ' + targetUser.last_name : ''}`
          : `User ${targetUserId}`;

        // Notify the person who paid the expense
        try {
          let notificationMsg = `💰 *Payment Received*\n` +
            `Group: ${escapeMarkdown(groupName)}\n\n` +
            `Admin ${escapeMarkdown(adminName)} marked ${escapeMarkdown(targetName)}'s payment as paid!\n` +
            `Amount: *${currency} ${split.amount_owed.toFixed(2)}*\n` +
            `Expense #${expense.id}\n` +
            (expense.description ? `Description: ${escapeMarkdown(expense.description)}\n` : '') +
            (expense.location ? `Location: ${escapeMarkdown(expense.location)}\n` : '');

          notificationMsg += `\n\n👉 Tap to pay: https://t.me/${env.BOT_USERNAME.replace(/_/g, '\\_')}/app?startapp=myexpenses-${groupId}`;

          await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: expense.paid_by,
              text: notificationMsg,
              parse_mode: 'Markdown',
              disable_web_page_preview: false
            })
          });
        } catch (error) {
          console.log(`Could not send DM to payer ${expense.paid_by}:`, error);
        }

        // Notify the user whose payment was marked
        try {
          let userNotificationMsg = `✅ *Payment Marked Complete*\n` +
            `Group: ${escapeMarkdown(groupName)}\n\n` +
            `Admin marked your payment as complete!\n` +
            `Amount: *${currency} ${split.amount_owed.toFixed(2)}*\n` +
            `Expense #${expense.id}\n` +
            (expense.description ? `Description: ${escapeMarkdown(expense.description)}\n` : '') +
            (expense.location ? `Location: ${escapeMarkdown(expense.location)}\n` : '');

          userNotificationMsg += `\n\n👉 Tap to pay: https://t.me/${env.BOT_USERNAME.replace(/_/g, '\\_')}/app?startapp=myexpenses-${groupId}`;

          await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: targetUserId,
              text: userNotificationMsg,
              parse_mode: 'Markdown',
              disable_web_page_preview: false
            })
          });
        } catch (error) {
          console.log(`Could not send DM to user ${targetUserId}:`, error);
        }
      } catch (error) {
        console.error('Error sending notifications:', error);
        // Don't fail the operation if notifications fail
      }
    }

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Error admin marking paid:', error);
    return jsonResponse({ error: 'Failed to mark as paid' }, 500);
  }
}

function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
