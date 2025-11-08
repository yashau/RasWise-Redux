# RasWise Redux

A Telegram Mini App for splitting expenses among group members, built on Cloudflare Workers.

## Overview

RasWise Redux is a modern expense-splitting bot that runs as a **Telegram Mini App**, providing a native app-like experience directly within Telegram. Users interact through an intuitive web interface that launches from the bot, eliminating the need for traditional slash commands and creating a seamless mobile experience.

## Key Features

### Mini App Interface
- **Native App Experience**: Full-featured web app that runs inside Telegram
- **No Commands Needed**: All interactions through buttons, forms, and touch-friendly UI
- **Multi-Group Support**: Easily switch between different group chats
- **Real-Time Updates**: Instant synchronization with the backend
- **Responsive Design**: Optimized for mobile devices

### Core Functionality
- **User Management**: View registered users and their account status
- **Expense Tracking**: Add expenses with descriptions, locations, and photo attachments
- **Flexible Splitting**: Split bills equally or set custom amounts per person
- **Payment Tracking**: Mark expenses as paid with optional proof of payment
- **Photo Attachments**: Support for bill photos, vendor payment slips, and transfer receipts
- **Payment History**: Comprehensive history of all transactions and payments
- **Summary Views**: See who owes what at a glance
- **Group Settings**: Configure timezone, currency, and reminder preferences
- **Admin Controls**: Special permissions for group admins

### Privacy & Security
- **Secure Authentication**: Telegram Web App authentication with signature validation
- **Private Data**: Personal financial information only visible to relevant users
- **Edge Computing**: Fast response times with global Cloudflare Workers
- **Data Isolation**: Each group's data is completely separate

## Tech Stack

- **Runtime**: Cloudflare Workers (serverless at the edge)
- **Bot Framework**: grammY (web variant for Workers)
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2 (for bill photos, vendor slips, transfer receipts)
- **Session Management**: Cloudflare KV
- **Frontend**: Vanilla JavaScript with Telegram Mini App SDK
- **Language**: TypeScript with strict typing
- **Testing**: Vitest + Miniflare (83 tests, 4 test suites)

## Mini App Features

### Home Screen (`app.html`)
Central dashboard showing:
- Quick actions (Add Expense, Pay, View Summary, etc.)
- Recent expense notifications
- Pending payment reminders
- Easy navigation to all features

### Add Expense (`addexpense.html`)
Interactive form for creating expenses:
- Amount input with currency display
- Optional description and location
- Photo upload for bills and vendor payment slips
- User selection with visual checkboxes
- Payer selection
- Equal or custom split options
- Real-time validation and feedback

### My Expenses (`myexpenses.html`)
View your financial obligations:
- List of unpaid expenses with amounts
- Payment history with transfer slips
- Total pending and paid amounts
- Direct links to pay or view details
- Grouped by status

### Payment Interface (`pay.html`)
Streamlined payment flow:
- Select expense to pay
- View payment details and recipient account info
- Upload transfer slip as proof
- Instant confirmation and notifications

### Summary View (`summary.html`)
Financial overview:
- Total unpaid and paid amounts
- Breakdown by person (who you owe)
- Number of pending expenses
- Quick links to relevant actions

### History (`history.html`)
Group expense history:
- Chronological list of all expenses
- View attachments (bills, vendor slips)
- Payment status indicators
- Filter and search capabilities

### Owed to You (`owed.html`)
Track incoming payments:
- Who owes you money
- Breakdown by expense
- Total pending and received amounts
- Payment status for each person

### User Management (`users.html`)
Group member list:
- View all registered users
- See account status indicators
- Check who has set up payment details

### Account Settings (`account.html`)
Personal financial setup:
- Set/update bank account number
- View saved payment details
- Privacy information

### Group Settings (`settings.html`)
Configure group preferences (admin only):
- Toggle daily reminders on/off
- Set timezone for the group
- Choose currency symbol
- View last reminder sent timestamp

## How It Works

### Getting Started

1. **Add the Bot to Your Group**
   - Search for `@raswise_bot` on Telegram
   - Add it to your group chat
   - Grant necessary permissions
   - Users are automatically registered when they send any message in the group

2. **Open the Mini App**
   - Click the bot's name or type `@raswise_bot`
   - Tap "Open App" or use the menu button
   - The Mini App launches inside Telegram

3. **Start Splitting Expenses**
   - Tap "Add Expense"
   - Fill in the details
   - Select who's involved
   - Choose split method
   - Done!

### Typical Workflow

**Scenario: Team lunch costs $300, Alice pays**

1. Alice opens the Mini App and taps "Add Expense"
2. Enters amount: 300
3. Description: "Team lunch at Pizza Place"
4. Uploads photo of the restaurant bill
5. Uploads proof of payment to restaurant
6. Selects team members: Alice, Bob, Charlie
7. Marks herself as the payer
8. Chooses "Equal Split"
9. Bob and Charlie each owe Alice $100 (300 ÷ 3 = $100 per person)

**Bob paying back Alice:**

1. Bob opens the Mini App
2. Goes to "My Expenses"
3. Sees he owes Alice $100
4. Taps "Pay"
5. Views Alice's account number
6. Makes bank transfer
7. Uploads screenshot of transfer
8. Marks as paid
9. Alice receives notification


## Setup & Deployment

### Prerequisites

- Node.js 18+ installed
- A Cloudflare account
- A Telegram Bot Token (get one from [@BotFather](https://t.me/botfather))
- Your bot's username (set in BotFather)

### Installation

1. **Clone and Install**
```bash
git clone <your-repo-url>
cd RasWise-Redux
npm install
```

2. **Create Cloudflare Resources**

Create D1 Database:
```bash
npx wrangler d1 create raswise_db
```

Copy the database ID to [wrangler.toml](wrangler.toml:13):
```toml
[[d1_databases]]
binding = "DB"
database_name = "raswise_db"
database_id = "YOUR_DATABASE_ID_HERE"
```

Initialize the schema:
```bash
npx wrangler d1 execute raswise_db --file=./schema.sql
```

Create KV namespace:
```bash
npx wrangler kv namespace create "raswise_kv"
```

Update [wrangler.toml](wrangler.toml:18) with the KV ID:
```toml
[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_ID_HERE"
```

Create R2 bucket:
```bash
npx wrangler r2 bucket create raswise-bills
```

3. **Configure Environment**

Set your bot token as a secret:
```bash
npx wrangler secret put BOT_TOKEN
```

Update [wrangler.toml](wrangler.toml:28) with your settings:
```toml
[vars]
WEBHOOK_DOMAIN = "https://your-worker.workers.dev"
R2_PUBLIC_URL = "https://your-r2-public-url.com"
BOT_USERNAME = "your_bot_username"
```

4. **Deploy**
```bash
npm run deploy
```

5. **Set Up the Mini App in BotFather**

Talk to [@BotFather](https://t.me/botfather) on Telegram:
```
/setmenubutton
<select your bot>
<button text: Open App>
<web app url: https://your-worker.workers.dev/app.html>
```

Also set the bot's web app:
```
/newapp
<select your bot>
<title: RasWise>
<description: Split expenses with friends>
<photo: upload an icon>
<web app url: https://your-worker.workers.dev/app.html>
```

6. **Set Webhook**

The bot will automatically set up the webhook on first deployment, but you can verify:
```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-worker.workers.dev/webhook"
```

### Development

Run locally with hot reload:
```bash
npm run dev
```

For testing the Mini App locally, you'll need to:
1. Use ngrok or cloudflared to expose your local server
2. Update the webhook URL to your tunnel URL
3. Set the menu button in BotFather to your tunnel URL

## Testing

### Run Tests
```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Type checking
npm run typecheck
```

### Test Coverage

The project has **83 tests** across **4 test suites**:

- **[src/test/utils.test.ts](src/test/utils.test.ts)** - Utility function tests
  - Date/datetime formatting with timezone support
  - User name formatting
  - Amount formatting
  - Session management

- **[src/test/db.test.ts](src/test/db.test.ts)** - Database operations
  - User CRUD operations
  - Group registration
  - Expense creation and management
  - Payment recording and history
  - Summary calculations
  - Reminder and timezone settings

- **[src/test/reminders.test.ts](src/test/reminders.test.ts)** - Reminder system
  - Daily reminder scheduling
  - Reminder settings per group
  - Notification delivery

- **[src/test/telegram-auth.test.ts](src/test/telegram-auth.test.ts)** - Authentication
  - Telegram Web App data validation
  - Signature verification
  - User data parsing

All tests use the actual production [schema.sql](schema.sql) and Miniflare for a realistic Cloudflare Workers environment.

## Project Structure

```
RasWise-Redux/
├── public/                 # Mini App frontend
│   ├── app.html           # Main dashboard
│   ├── addexpense.html    # Add expense form
│   ├── myexpenses.html    # User's expenses
│   ├── pay.html           # Payment interface
│   ├── summary.html       # Financial summary
│   ├── history.html       # Group history
│   ├── owed.html          # Payments owed to user
│   ├── users.html         # User management
│   ├── account.html       # Account settings
│   ├── settings.html      # Group settings
│   ├── adminpay.html      # Admin payment marking
│   ├── miniapp.css        # Shared styles
│   └── miniapp.js         # Shared JavaScript utilities
├── src/
│   ├── index.ts           # Main worker entry point
│   ├── api-handlers.ts    # API endpoints for Mini App
│   ├── db.ts              # Database operations
│   ├── telegram-auth.ts   # Telegram Web App auth validation
│   ├── types.ts           # TypeScript type definitions
│   ├── utils.ts           # Utility functions
│   ├── handlers/
│   │   └── reminders.ts   # Reminder system
│   └── test/
│       ├── db.test.ts
│       ├── utils.test.ts
│       ├── reminders.test.ts
│       └── telegram-auth.test.ts
├── schema.sql             # Database schema
├── wrangler.toml          # Cloudflare Workers config
├── package.json
└── tsconfig.json
```

## API Endpoints

The Mini App communicates with the backend through these API endpoints:

- `GET /api/user-groups` - Get user's groups
- `GET /api/group-users` - Get registered users in a group
- `GET /api/unpaid-expenses` - Get unpaid expenses for a user
- `GET /api/user-expenses` - Get all expenses for a user
- `GET /api/summary` - Get financial summary for a user
- `GET /api/history` - Get group expense history
- `GET /api/owed` - Get payments owed to a user
- `POST /api/add-expense` - Create a new expense
- `POST /api/mark-paid` - Mark an expense as paid
- `POST /api/admin-pay` - Admin mark payment (admin only)
- `GET /api/group-settings` - Get group settings
- `POST /api/update-reminders` - Update reminder settings
- `POST /api/update-timezone` - Update group timezone
- `POST /api/update-currency` - Update group currency

All API requests are authenticated using Telegram Web App data validation.

## Database Schema

### Core Tables

- **`users`** - Registered Telegram users
  - `id`, `telegram_id`, `username`, `first_name`, `last_name`

- **`account_details`** - User payment information
  - `user_id`, `account_number`, `updated_at`

- **`group_users`** - User-group relationships
  - `group_id`, `user_id`, `registered_at`

- **`expenses`** - Expense records
  - `id`, `group_id`, `paid_by_user_id`, `total_amount`
  - `description`, `location`, `created_at`
  - `photo_url`, `vendor_payment_slip_url`
  - `split_type` (equal/custom)

- **`expense_splits`** - Individual split amounts
  - `expense_id`, `user_id`, `amount_owed`, `paid`

- **`payments`** - Payment transaction records
  - `expense_id`, `payer_id`, `amount`, `paid_at`
  - `transfer_slip_url`, `marked_by_admin`

- **`reminder_settings`** - Group reminder preferences
  - `group_id`, `enabled`, `last_reminder_sent`

- **`group_timezones`** - Group timezone settings
  - `group_id`, `timezone_offset`

- **`group_currencies`** - Group currency settings
  - `group_id`, `currency`

### Storage Structure (R2 Bucket)

```
raswise-bills/
├── bills/{groupId}/{timestamp}_{fileId}.jpg
├── vendor_slips/{groupId}/{timestamp}_{fileId}.jpg
└── transfer_slips/{userId}/{timestamp}_{fileId}.jpg
```

## Architecture

```
┌─────────────────────────────────────┐
│       Telegram Users                │
└───────────────┬─────────────────────┘
                │
                ▼
┌─────────────────────────────────────┐
│    Telegram Mini App (Frontend)    │
│    - HTML/CSS/JavaScript            │
│    - Telegram Web App SDK           │
│    - Responsive UI                  │
└───────────────┬─────────────────────┘
                │ HTTPS + Auth
                ▼
┌─────────────────────────────────────┐
│    Cloudflare Workers               │
│    ┌─────────────────────┐         │
│    │   Main Worker       │         │
│    │   - API Handlers    │         │
│    │   - Auth Validation │         │
│    │   - Bot Commands    │         │
│    └──────┬───┬───┬──────┘         │
└───────────┼───┼───┼─────────────────┘
            │   │   │
      ┌─────┘   │   └─────┐
      ▼         ▼         ▼
   ┌────┐    ┌────┐    ┌────┐
   │ D1 │    │ KV │    │ R2 │
   └────┘    └────┘    └────┘
   SQLite    Session   Photos
   Database  Storage   Storage
```

## Key Implementation Details

### Authentication Flow

1. User opens Mini App in Telegram
2. Telegram sends `initData` with signature
3. Worker validates signature using bot token
4. If valid, user is authenticated and can make API calls
5. Each API request includes `X-Telegram-Init-Data` header

Implementation: [src/telegram-auth.ts](src/telegram-auth.ts)

### Photo Upload Flow

1. User selects photo in Mini App
2. Frontend converts to base64
3. Sends to API endpoint with expense data
4. Worker fetches high-res version from Telegram
5. Uploads to R2 bucket
6. Stores public URL in database

### Reminder System

1. Cron trigger runs daily at 10:00 AM UTC
2. Worker checks groups with reminders enabled
3. Queries for users with unpaid expenses
4. Sends DM to each user with summary
5. Updates `last_reminder_sent` timestamp

Implementation: [src/handlers/reminders.ts](src/handlers/reminders.ts)

## Troubleshooting

### Mini App Not Loading
- Check that `WEBHOOK_DOMAIN` in [wrangler.toml](wrangler.toml) is correct
- Verify the menu button URL in BotFather
- Check browser console for errors
- Ensure assets are deployed (run `npm run deploy`)

### Authentication Errors
- Verify `BOT_TOKEN` is set correctly: `npx wrangler secret list`
- Check that the bot username is correct in [wrangler.toml](wrangler.toml)
- Ensure the Mini App is opened from Telegram (not directly in browser)

### Database Errors
- Reinitialize schema: `npx wrangler d1 execute raswise_db --file=./schema.sql`
- Check D1 binding in [wrangler.toml](wrangler.toml)
- View logs: `npx wrangler tail`

### Photos Not Appearing
- Verify R2 bucket exists: `npx wrangler r2 bucket list`
- Check `R2_PUBLIC_URL` in [wrangler.toml](wrangler.toml)
- Ensure R2 bucket has public access configured
- Check R2 binding in [wrangler.toml](wrangler.toml)

### Reminders Not Working
- Verify cron trigger is set in [wrangler.toml](wrangler.toml)
- Check that reminders are enabled in group settings
- Test manually: `curl https://your-worker.workers.dev/cron/reminders`
- View logs: `npx wrangler tail`

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Run tests: `npm test`
5. Run type checking: `npm run typecheck`
6. Commit with descriptive message
7. Push and create a Pull Request

## License

MIT

## Acknowledgments

Built with:
- [grammY](https://grammy.dev/) - Telegram Bot Framework
- [Telegram Mini Apps](https://core.telegram.org/bots/webapps) - Web App Platform
- [Cloudflare Workers](https://workers.cloudflare.com/) - Serverless Platform
- [Cloudflare D1](https://developers.cloudflare.com/d1/) - Edge Database
- [Cloudflare R2](https://developers.cloudflare.com/r2/) - Object Storage
- [Vitest](https://vitest.dev/) - Testing Framework

---

Made with Cloudflare Workers • Powered by Telegram Mini Apps
