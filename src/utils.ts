import type { Context } from 'grammy/web';
import type { User } from './types';

// Helper function to format dates in ISO standard (YYYY/MM/DD)
// timezoneOffset: Hours offset from UTC (e.g., +5.5 for IST, -5 for EST)
export function formatDate(timestamp: number, timezoneOffset: number = 0): string {
  const date = new Date(timestamp);
  // Apply timezone offset (convert hours to milliseconds)
  const offsetMs = timezoneOffset * 60 * 60 * 1000;
  const localDate = new Date(date.getTime() + offsetMs);

  const year = localDate.getUTCFullYear();
  const month = String(localDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(localDate.getUTCDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

// Helper function to format dates with time in ISO standard (YYYY/MM/DD HH:MM:SS)
// timezoneOffset: Hours offset from UTC (e.g., +5.5 for IST, -5 for EST)
export function formatDateTime(timestamp: number, timezoneOffset: number = 0): string {
  const date = new Date(timestamp);
  // Apply timezone offset (convert hours to milliseconds)
  const offsetMs = timezoneOffset * 60 * 60 * 1000;
  const localDate = new Date(date.getTime() + offsetMs);

  const year = localDate.getUTCFullYear();
  const month = String(localDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(localDate.getUTCDate()).padStart(2, '0');
  const hours = String(localDate.getUTCHours()).padStart(2, '0');
  const minutes = String(localDate.getUTCMinutes()).padStart(2, '0');
  const seconds = String(localDate.getUTCSeconds()).padStart(2, '0');
  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

// Helper function to format user display name
// Priority: First Name + Last Name > First Name > Username > Telegram ID
export function formatUserName(user: User | null | undefined, userId?: number): string {
  if (!user && !userId) return 'Unknown User';
  if (!user && userId) return `User ${userId}`;

  // If we have first name, check if we also have last name
  if (user!.first_name) {
    if (user!.last_name) {
      return `${user!.first_name} ${user!.last_name}`;
    }
    return user!.first_name;
  }

  // Fall back to username or telegram ID
  return user!.username || `User ${user!.telegram_id}`;
}

// Helper function to format currency amounts
export function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

// Helper function to send DM with fallback error message
export async function sendDMWithFallback(
  ctx: Context,
  userId: number,
  message: string
): Promise<void> {
  try {
    await ctx.api.sendMessage(userId, message);
  } catch (error) {
    await ctx.reply(
      '❌ I couldn\'t send you a DM. Please start a chat with me first by clicking my name and pressing "Start".'
    );
  }
}

// Helper function to save session to KV with TTL
export async function saveSession(
  kv: KVNamespace,
  key: string,
  session: any,
  ttlSeconds = 600
): Promise<void> {
  await kv.put(key, JSON.stringify(session), { expirationTtl: ttlSeconds });
}

// Helper function to get session from KV with expiration check
export async function getSession<T>(
  kv: KVNamespace,
  key: string,
  ctx: Context
): Promise<T | null> {
  const data = await kv.get(key);
  if (!data) {
    await ctx.answerCallbackQuery({ text: 'Session expired' });
    return null;
  }
  return JSON.parse(data) as T;
}
