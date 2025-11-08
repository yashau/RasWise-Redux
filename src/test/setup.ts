import { Miniflare } from 'miniflare';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Env } from '../types';

export async function createTestEnv() {
  const mf = new Miniflare({
    modules: true,
    script: '',
    d1Databases: ['DB'],
    kvNamespaces: ['KV'],
    r2Buckets: ['BILLS_BUCKET'],
    bindings: {
      BOT_TOKEN: 'test_bot_token',
      WEBHOOK_DOMAIN: 'https://test.example.com'
    }
  });

  const db = await mf.getD1Database('DB');
  const kv = await mf.getKVNamespace('KV');
  const r2 = await mf.getR2Bucket('BILLS_BUCKET');

  // Initialize database schema
  const schema = readFileSync(resolve(__dirname, '../../schema.sql'), 'utf-8');

  // Remove SQL comments (-- style)
  const cleanedSchema = schema
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('--');
    })
    .join('\n');

  // Split statements by semicolon, handling multi-line statements
  const statements: string[] = [];
  let current = '';
  let parenthesesDepth = 0;

  for (let i = 0; i < cleanedSchema.length; i++) {
    const char = cleanedSchema[i];
    current += char;

    if (char === '(') {
      parenthesesDepth++;
    } else if (char === ')') {
      parenthesesDepth--;
    } else if (char === ';' && parenthesesDepth === 0) {
      const stmt = current.trim();
      if (stmt.length > 1) {  // More than just the semicolon
        statements.push(stmt.slice(0, -1).trim());  // Remove trailing semicolon
      }
      current = '';
    }
  }

  // Execute each statement
  for (const statement of statements) {
    if (statement && statement.toUpperCase().includes('CREATE')) {
      try {
        await db.prepare(statement).run();
      } catch (error) {
        console.error('Failed to execute statement:', statement.substring(0, 100));
        throw error;
      }
    }
  }

  return {
    mf,
    env: {
      DB: db as any,
      KV: kv as any,
      BILLS_BUCKET: r2 as any,
      BOT_TOKEN: 'test_bot_token',
      WEBHOOK_DOMAIN: 'https://test.example.com',
      R2_PUBLIC_URL: 'https://test-r2.example.com',
      BOT_USERNAME: 'test_bot'
    } as unknown as Env
  };
}

export async function cleanupTestEnv(mf: Miniflare) {
  await mf.dispose();
}
