import type { User } from './types';

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
export function formatAmount(amount: number, currency: string = '$'): string {
  const formatted = amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${formatted}`;
}

// Helper function to escape Markdown special characters for Telegram
// In Telegram's basic Markdown mode, only _ * [ and ` need escaping
export function escapeMarkdown(text: string): string {
  if (!text) return '';
  // Only escape characters that actually break Telegram's Markdown: _ * [ ]
  return text
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[')
    .replace(/]/g, '\\]');
}
