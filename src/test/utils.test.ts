import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatDate, formatDateTime, formatUserName, formatAmount, sendDMWithFallback, saveSession, getSession } from '../utils';
import type { User } from '../types';
import type { Context } from 'grammy/web';

describe('Utility Functions', () => {
  describe('formatDate', () => {
    it('should format date as YYYY/MM/DD', () => {
      const timestamp = new Date('2025-01-15T10:30:00Z').getTime();
      const formatted = formatDate(timestamp);
      expect(formatted).toBe('2025/01/15');
    });

    it('should pad single digit months and days with zeros', () => {
      const timestamp = new Date('2025-03-05T10:30:00Z').getTime();
      const formatted = formatDate(timestamp);
      expect(formatted).toBe('2025/03/05');
    });

    it('should handle year-end dates correctly in local timezone', () => {
      // Test with a date that's clearly in the specified year
      const date = new Date(2024, 11, 30, 12, 0, 0); // Dec 30, 2024, noon local time
      const formatted = formatDate(date.getTime());
      expect(formatted).toBe('2024/12/30');
    });

    it('should apply positive timezone offset correctly', () => {
      // 2025-01-15 00:00:00 UTC + 5 hours = 2025-01-15 05:00:00
      const timestamp = new Date('2025-01-15T00:00:00Z').getTime();
      const formatted = formatDate(timestamp, 5);
      expect(formatted).toBe('2025/01/15');
    });

    it('should apply negative timezone offset correctly', () => {
      // 2025-01-15 03:00:00 UTC - 5 hours = 2025-01-14 22:00:00
      const timestamp = new Date('2025-01-15T03:00:00Z').getTime();
      const formatted = formatDate(timestamp, -5);
      expect(formatted).toBe('2025/01/14');
    });

    it('should handle decimal timezone offsets', () => {
      // 2025-01-15 00:00:00 UTC + 5.5 hours = 2025-01-15 05:30:00
      const timestamp = new Date('2025-01-15T00:00:00Z').getTime();
      const formatted = formatDate(timestamp, 5.5);
      expect(formatted).toBe('2025/01/15');
    });

    it('should handle date boundary crossing with timezone offset', () => {
      // 2025-01-15 23:00:00 UTC + 8 hours = 2025-01-16 07:00:00
      const timestamp = new Date('2025-01-15T23:00:00Z').getTime();
      const formatted = formatDate(timestamp, 8);
      expect(formatted).toBe('2025/01/16');
    });
  });

  describe('formatDateTime', () => {
    it('should format datetime as YYYY/MM/DD HH:MM:SS', () => {
      const timestamp = new Date('2025-01-15T10:30:45Z').getTime();
      const formatted = formatDateTime(timestamp);
      expect(formatted).toMatch(/2025\/01\/15 \d{2}:\d{2}:\d{2}/);
    });

    it('should pad single digit hours, minutes, and seconds with zeros', () => {
      // Use UTC time to avoid timezone issues
      const timestamp = new Date('2025-01-05T08:05:03Z').getTime();
      const formatted = formatDateTime(timestamp);
      expect(formatted).toBe('2025/01/05 08:05:03');
    });

    it('should apply positive timezone offset to datetime', () => {
      // 2025-01-15 10:00:00 UTC + 5 hours = 2025-01-15 15:00:00
      const timestamp = new Date('2025-01-15T10:00:00Z').getTime();
      const formatted = formatDateTime(timestamp, 5);
      expect(formatted).toBe('2025/01/15 15:00:00');
    });

    it('should apply negative timezone offset to datetime', () => {
      // 2025-01-15 10:00:00 UTC - 5 hours = 2025-01-15 05:00:00
      const timestamp = new Date('2025-01-15T10:00:00Z').getTime();
      const formatted = formatDateTime(timestamp, -5);
      expect(formatted).toBe('2025/01/15 05:00:00');
    });

    it('should handle decimal timezone offsets with minutes', () => {
      // 2025-01-15 10:00:00 UTC + 5.5 hours = 2025-01-15 15:30:00
      const timestamp = new Date('2025-01-15T10:00:00Z').getTime();
      const formatted = formatDateTime(timestamp, 5.5);
      expect(formatted).toBe('2025/01/15 15:30:00');
    });

    it('should handle day boundary crossing with timezone offset', () => {
      // 2025-01-15 22:00:00 UTC + 8 hours = 2025-01-16 06:00:00
      const timestamp = new Date('2025-01-15T22:00:00Z').getTime();
      const formatted = formatDateTime(timestamp, 8);
      expect(formatted).toBe('2025/01/16 06:00:00');
    });
  });

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
    it('should format amount with 2 decimal places', () => {
      expect(formatAmount(100)).toBe('100.00');
      expect(formatAmount(100.5)).toBe('100.50');
      expect(formatAmount(100.567)).toBe('100.57');
    });

    it('should handle zero', () => {
      expect(formatAmount(0)).toBe('0.00');
    });

    it('should handle negative amounts', () => {
      expect(formatAmount(-50.5)).toBe('-50.50');
    });

    it('should round properly', () => {
      // toFixed uses banker's rounding, so 10.995 rounds to 11.00 but may vary
      // Test with more clear-cut rounding cases
      expect(formatAmount(10.996)).toBe('11.00');
      expect(formatAmount(10.994)).toBe('10.99');
      expect(formatAmount(10.999)).toBe('11.00');
      expect(formatAmount(10.991)).toBe('10.99');
    });
  });

  describe('sendDMWithFallback', () => {
    let mockCtx: any;

    beforeEach(() => {
      mockCtx = {
        api: {
          sendMessage: vi.fn()
        },
        reply: vi.fn()
      };
    });

    it('should send message successfully when no error', async () => {
      mockCtx.api.sendMessage.mockResolvedValue({});

      await sendDMWithFallback(mockCtx as Context, 123, 'Test message');

      expect(mockCtx.api.sendMessage).toHaveBeenCalledWith(123, 'Test message', { parse_mode: 'Markdown' });
      expect(mockCtx.reply).not.toHaveBeenCalled();
    });

    it('should reply with fallback message when DM fails', async () => {
      mockCtx.api.sendMessage.mockRejectedValue(new Error('User has not started bot'));

      await sendDMWithFallback(mockCtx as Context, 123, 'Test message');

      expect(mockCtx.api.sendMessage).toHaveBeenCalledWith(123, 'Test message', { parse_mode: 'Markdown' });
      expect(mockCtx.reply).toHaveBeenCalledWith(
        '*Error:* I couldn\'t send you a DM. Please start a chat with me first by clicking my name and pressing "Start".',
        { parse_mode: 'Markdown' }
      );
    });
  });

  describe('saveSession', () => {
    let mockKv: any;

    beforeEach(() => {
      mockKv = {
        put: vi.fn().mockResolvedValue(undefined)
      };
    });

    it('should save session with default TTL of 600 seconds', async () => {
      const session = { step: 'amount', amount: 100 };

      await saveSession(mockKv, 'test-key', session);

      expect(mockKv.put).toHaveBeenCalledWith(
        'test-key',
        JSON.stringify(session),
        { expirationTtl: 600 }
      );
    });

    it('should save session with custom TTL', async () => {
      const session = { step: 'info', account_type: 'bank' };

      await saveSession(mockKv, 'payment-key', session, 300);

      expect(mockKv.put).toHaveBeenCalledWith(
        'payment-key',
        JSON.stringify(session),
        { expirationTtl: 300 }
      );
    });

    it('should handle complex session objects', async () => {
      const session = {
        step: 'custom_splits',
        amount: 500,
        selected_users: [111, 222, 333],
        custom_splits: { 111: 200, 222: 150, 333: 150 }
      };

      await saveSession(mockKv, 'expense-key', session);

      expect(mockKv.put).toHaveBeenCalledWith(
        'expense-key',
        JSON.stringify(session),
        { expirationTtl: 600 }
      );
    });
  });

  describe('getSession', () => {
    let mockKv: any;
    let mockCtx: any;

    beforeEach(() => {
      mockKv = {
        get: vi.fn()
      };
      mockCtx = {
        answerCallbackQuery: vi.fn().mockResolvedValue({})
      };
    });

    it('should return parsed session when data exists', async () => {
      const session = { step: 'amount', amount: 100 };
      mockKv.get.mockResolvedValue(JSON.stringify(session));

      const result = await getSession<typeof session>(mockKv, 'test-key', mockCtx as Context);

      expect(result).toEqual(session);
      expect(mockKv.get).toHaveBeenCalledWith('test-key');
      expect(mockCtx.answerCallbackQuery).not.toHaveBeenCalled();
    });

    it('should return null and show expiration message when no data', async () => {
      mockKv.get.mockResolvedValue(null);

      const result = await getSession(mockKv, 'test-key', mockCtx as Context);

      expect(result).toBeNull();
      expect(mockKv.get).toHaveBeenCalledWith('test-key');
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'Session expired' });
    });

    it('should handle complex session types', async () => {
      interface ComplexSession {
        step: string;
        amount: number;
        users: number[];
      }

      const session: ComplexSession = {
        step: 'users',
        amount: 500,
        users: [111, 222, 333]
      };

      mockKv.get.mockResolvedValue(JSON.stringify(session));

      const result = await getSession<ComplexSession>(mockKv, 'test-key', mockCtx as Context);

      expect(result).toEqual(session);
      expect(result?.users).toHaveLength(3);
    });
  });
});
