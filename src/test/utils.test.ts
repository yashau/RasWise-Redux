import { describe, it, expect } from 'vitest';
import { formatUserName, formatAmount, escapeMarkdown } from '../utils';
import type { User } from '../types';

describe('Utility Functions', () => {

  describe('formatUserName', () => {
    it('should return "Unknown User" when user is null and no userId provided', () => {
      const result = formatUserName(null);
      expect(result).toBe('Unknown User');
    });

    it('should return "User {id}" when user is null but userId is provided', () => {
      const result = formatUserName(null, 123456);
      expect(result).toBe('User 123456');
    });

    it('should return first name + last name when both are available', () => {
      const user: User = {
        telegram_id: 123,
        first_name: 'John',
        last_name: 'Doe',
        username: 'johndoe',
        created_at: Date.now()
      };
      const result = formatUserName(user);
      expect(result).toBe('John Doe');
    });

    it('should return only first name when last name is not available', () => {
      const user: User = {
        telegram_id: 123,
        first_name: 'John',
        username: 'johndoe',
        created_at: Date.now()
      };
      const result = formatUserName(user);
      expect(result).toBe('John');
    });

    it('should return username when first name is not available', () => {
      const user: User = {
        telegram_id: 123,
        username: 'johndoe',
        created_at: Date.now()
      };
      const result = formatUserName(user);
      expect(result).toBe('johndoe');
    });

    it('should return "User {id}" when only telegram_id is available', () => {
      const user: User = {
        telegram_id: 123,
        created_at: Date.now()
      };
      const result = formatUserName(user);
      expect(result).toBe('User 123');
    });

    it('should use fallback userId parameter when user data is incomplete', () => {
      const user: User = {
        telegram_id: 123,
        created_at: Date.now()
      };
      const result = formatUserName(user, 456);
      expect(result).toBe('User 123'); // Should use user's telegram_id, not fallback
    });
  });

  describe('formatAmount', () => {
    it('should format amount with currency and 2 decimal places', () => {
      expect(formatAmount(100)).toBe('$ 100.00');
      expect(formatAmount(100.5)).toBe('$ 100.50');
      expect(formatAmount(100.567)).toBe('$ 100.57');
    });

    it('should handle custom currency symbols', () => {
      expect(formatAmount(100, '₹')).toBe('₹ 100.00');
      expect(formatAmount(50.5, '€')).toBe('€ 50.50');
      expect(formatAmount(75.99, '£')).toBe('£ 75.99');
    });

    it('should handle zero', () => {
      expect(formatAmount(0)).toBe('$ 0.00');
      expect(formatAmount(0, '₹')).toBe('₹ 0.00');
    });

    it('should handle negative amounts', () => {
      expect(formatAmount(-50.5)).toBe('$ -50.50');
      expect(formatAmount(-100, '€')).toBe('€ -100.00');
    });

    it('should add thousands separator for large amounts', () => {
      expect(formatAmount(1000)).toBe('$ 1,000.00');
      expect(formatAmount(1234567.89, '₹')).toBe('₹ 1,234,567.89');
      expect(formatAmount(999999.99)).toBe('$ 999,999.99');
    });

    it('should round properly', () => {
      expect(formatAmount(10.996)).toBe('$ 11.00');
      expect(formatAmount(10.994)).toBe('$ 10.99');
      expect(formatAmount(10.999)).toBe('$ 11.00');
      expect(formatAmount(10.991)).toBe('$ 10.99');
    });
  });

  describe('escapeMarkdown', () => {
    it('should escape underscores', () => {
      expect(escapeMarkdown('hello_world')).toBe('hello\\_world');
      expect(escapeMarkdown('___')).toBe('\\_\\_\\_');
    });

    it('should escape asterisks', () => {
      expect(escapeMarkdown('hello*world')).toBe('hello\\*world');
      expect(escapeMarkdown('***bold***')).toBe('\\*\\*\\*bold\\*\\*\\*');
    });

    it('should escape square brackets', () => {
      expect(escapeMarkdown('hello[world]')).toBe('hello\\[world\\]');
      expect(escapeMarkdown('[link](url)')).toBe('\\[link\\](url)');
    });

    it('should escape all special characters together', () => {
      const input = 'Price: $50 [20% off] *NEW*';
      const expected = 'Price: $50 \\[20% off\\] \\*NEW\\*';
      expect(escapeMarkdown(input)).toBe(expected);
    });

    it('should handle empty string', () => {
      expect(escapeMarkdown('')).toBe('');
    });

    it('should handle string with no special characters', () => {
      expect(escapeMarkdown('Hello World 123')).toBe('Hello World 123');
    });

    it('should handle multiple consecutive special characters', () => {
      expect(escapeMarkdown('***___[[[')).toBe('\\*\\*\\*\\_\\_\\_\\[\\[\\[');
    });

    it('should preserve other characters like parentheses and backticks', () => {
      expect(escapeMarkdown('(hello) `code`')).toBe('(hello) `code`');
    });
  });
});
