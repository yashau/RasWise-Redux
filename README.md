# RasWise Redux 💰

A Telegram bot for splitting expenses among group members, built on Cloudflare Workers.

## Features

- **User Registration**: Register users in group chats to track their expenses
- **Payment Details**: Users can set and update their bank account details
- **Expense Tracking**: Add expenses with amount, description, location, and bill photos
- **Flexible Splitting**: Split bills equally or set custom amounts per person
- **Payment Tracking**: Track who owes what and mark expenses as paid
- **Daily Reminders**: Automatic daily reminders for pending expenses
- **Detailed History**: View expense history and summaries (sent via DM for privacy)

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Bot Framework**: grammY
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2 (for bill photos)
- **Session Management**: Cloudflare KV
- **Testing**: Vitest + Miniflare (97.22% coverage)

## Setup Instructions

### 1. Prerequisites

- Node.js 18+ installed
- A Cloudflare account
- A Telegram Bot Token (get one from [@BotFather](https://t.me/botfather))

### 2. Install Dependencies

```bash
npm install
```

### 3. Create Cloudflare Resources

#### Create D1 Database

```bash
npx wrangler d1 create raswise_db
```

Copy the database ID and update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "raswise_db"
database_id = "YOUR_DATABASE_ID_HERE"
```

#### Create Database Schema

```bash
npx wrangler d1 execute raswise_db --file=./schema.sql
```

#### Create KV Namespace

```bash
npx wrangler kv namespace create "raswise_kv"
```

Update `wrangler.toml` with the KV namespace ID:

```toml
[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_ID_HERE"
```

#### Create R2 Bucket

```bash
npx wrangler r2 bucket create raswise-bills
```

The bucket name is already configured in `wrangler.toml`.

### 4. Set Bot Token as Secret

```bash
npx wrangler secret put BOT_TOKEN
```

When prompted, paste your Telegram Bot Token.

### 5. Deploy to Cloudflare Workers

```bash
npm run deploy
```

After deployment, you'll get a worker URL like `https://raswise-redux.YOUR_SUBDOMAIN.workers.dev`

### 6. Set Up Telegram Webhook

Update `wrangler.toml` with your worker domain:

```toml
[vars]
WEBHOOK_DOMAIN = "https://raswise-redux.YOUR_SUBDOMAIN.workers.dev"
```

Then set the webhook:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://raswise-redux.YOUR_SUBDOMAIN.workers.dev/webhook"
```

### 7. Set Up Daily Reminders (Optional)

Add a cron trigger to `wrangler.toml`:

```toml
[triggers]
crons = ["0 10 * * *"]  # Runs at 10:00 AM UTC daily
```

Redeploy:

```bash
npm run deploy
```

## Usage

### Bot Commands

#### User Management
- `/start` - Get started and see all commands
- `/help` - Show help message with all commands
- `/register` - Reply to a user's message to register them in the group
- `/listusers` - List all registered users in the group
- `/setpayment` - Set or update your bank account number
- `/viewpayment` - View your saved payment details

#### Expense Management
- `/addexpense` - Start adding a new expense (interactive flow)
- `/myexpenses` - View your pending expenses (sent via DM)
- `/summary` - View your cumulative expense summary (sent via DM)
- `/history` - View group expense history (sent via DM)

#### Payments
- `/markpaid` - Mark an expense as paid
- `/owed` - See who owes you money (sent via DM)

#### Reminders
- `/setreminder` - Toggle daily reminders on/off for the group

### How to Use

#### 1. Register Users

In a group chat, reply to a user's message and use `/register`:

```
User: Hi everyone!
You: /register
Bot: ✅ User has been registered in this group!
```

#### 2. Set Payment Details

Each user should set their bank account:

```
/setpayment
Bot: Please send your bank account number:
You: 1234567890
Bot: ✅ Your payment details have been saved!
```

#### 3. Add an Expense

Use `/addexpense` and follow the interactive flow:

1. Enter the total amount
2. Add a description (optional)
3. Add a location (optional)
4. Upload a bill photo (optional)
5. Select users to split with
6. Choose equal or custom split
7. If custom, enter amounts for each person

#### 4. View Your Expenses

Use `/myexpenses` to see what you owe (sent via DM):

```
📊 Your Pending Expenses:

💰 Expense #1
Amount owed: 50.00
Description: Dinner at restaurant
Created by: John
Date: 1/15/2025

Total pending: 50.00
```

#### 5. Mark as Paid

When you've paid someone, use `/markpaid`:

1. Select the expense from the list
2. View payment details (recipient's bank account)
3. Make the payment
4. Click "I've Paid This"
5. The expense creator gets notified

#### 6. View Summary

Use `/summary` for a cumulative overview (sent via DM):

```
📊 Your Expense Summary:

💸 Total Unpaid: 150.00
✅ Total Paid: 300.00
📝 Pending Expenses: 3

💰 You owe:
  • John: 50.00 (1 expense)
  • Jane: 100.00 (2 expenses)
```

## Development

### Run Locally

```bash
npm run dev
```

This starts a local development server. You'll need to use a tool like ngrok to expose it to Telegram for testing.

### Generate TypeScript Types

```bash
npm run cf-typegen
```

## Database Schema

The bot uses the following tables:

- `users` - Registered users
- `payment_details` - User payment information
- `group_users` - User-group registrations
- `expenses` - Expense records
- `expense_splits` - Individual split amounts per user
- `payments` - Payment transaction history
- `reminder_settings` - Group reminder preferences

## Privacy Features

All personal financial information is sent via DM to protect user privacy:
- Expense history
- Payment summaries
- Who owes you money

Only group-level actions (registration, adding expenses) happen in the group chat.

## Architecture

```
┌─────────────────┐
│  Telegram Bot   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Cloudflare      │
│ Workers         │
│ (Bot Logic)     │
└────┬────┬───┬───┘
     │    │   │
     ▼    ▼   ▼
   ┌──┐ ┌──┐ ┌──┐
   │D1│ │KV│ │R2│
   └──┘ └──┘ └──┘
   DB  Cache Photos
```

## License

MIT

## Testing

Run the comprehensive test suite:

```bash
# Run all tests
npm test

# Run tests with coverage report
npm run test:coverage

# Type check
npm run typecheck
```

### Test Coverage
- **45 tests** covering all core functionality
- **97.22% overall coverage**
- Tests use actual production schema.sql
- Miniflare provides realistic Cloudflare Workers environment

## Support

If you encounter any issues, please check:
1. Bot token is correctly set
2. Webhook is properly configured
3. D1 database is initialized with schema
4. KV and R2 bindings are correct

For bugs and feature requests, open an issue on GitHub.
