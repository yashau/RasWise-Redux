# CLAUDE.md - Development Guide

This file contains important information for AI assistants (like Claude) working on this project.

## Project Overview

**RasWise Redux** is a Telegram Mini App for splitting expenses among group members, built on Cloudflare Workers.

### Key Architecture
- **Frontend**: Telegram Mini App (HTML/CSS/JavaScript) served from `/public`
- **Backend**: Cloudflare Workers with TypeScript
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2 for photos
- **Session**: Cloudflare KV for session management
- **Authentication**: Telegram Web App signature validation

### Tech Stack
- **Runtime**: Cloudflare Workers (edge computing)
- **Bot Framework**: grammY (web variant)
- **Language**: TypeScript with strict typing
- **Testing**: Vitest + Miniflare (83 tests across 4 suites)

## Critical: Managing wrangler.toml

### ⚠️ IMPORTANT: wrangler.toml contains sensitive credentials

The `wrangler.toml` file has two versions:
1. **Boilerplate** (in git repository) - with placeholder values
2. **Production** (local only) - with actual credentials

### Rules for wrangler.toml

**NEVER commit production credentials to git!**

### Workflow for Editing wrangler.toml

If you need to make changes to the boilerplate wrangler.toml structure:

1. **Stash the production file first:**
   ```bash
   cp wrangler.toml wrangler.toml.backup
   ```

2. **Restore boilerplate version:**
   ```bash
   git checkout HEAD -- wrangler.toml
   ```

3. **Make your changes** to the boilerplate version

4. **Commit the changes:**
   ```bash
   git add wrangler.toml
   git commit -m "Update wrangler.toml structure"
   ```

5. **Restore production file:**
   ```bash
   mv wrangler.toml.backup wrangler.toml
   ```

### Boilerplate vs Production

**Boilerplate (in git):**
```toml
# account_id = "" # Uncomment and fill with your Cloudflare account ID
# database_id = "" # Uncomment and fill after creating the database
# id = "" # Uncomment and fill after creating the KV namespace
WEBHOOK_DOMAIN = "" # Set this to your worker domain
R2_PUBLIC_URL = "" # Set this to your R2 bucket's public URL
BOT_USERNAME = "" # Your bot's username (without @)
```

**Production (local only):**
```toml
account_id = "your-cloudflare-account-id"
database_id = "your-d1-database-id"
id = "your-kv-namespace-id"
WEBHOOK_DOMAIN = "https://your-worker-domain.workers.dev"
R2_PUBLIC_URL = "https://your-r2-bucket-url.com"
BOT_USERNAME = "your_bot_username"
```

## Project Structure

```
RasWise-Redux/
├── public/                 # Mini App frontend (HTML/CSS/JS)
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
│   └── test/              # Test suites
├── schema.sql             # Database schema
├── wrangler.toml          # Cloudflare Workers config (SENSITIVE!)
├── package.json
├── tsconfig.json
└── README.md
```

## Key Features

### User Flow
1. Users are **automatically registered** when they send any message in a group with the bot
2. Users open the **Mini App** to interact with the bot (no slash commands needed)
3. All personal financial data is sent via **DM** for privacy
4. Admins have special permissions (unregister users, mark payments)

### Split Logic
- **Equal Split**: Total amount divided by number of users (including payer)
- **Custom Split**: Specify individual amounts per user
- **Payer is always excluded** from owing money (they get paid back)

### Photo Types
1. **Bill Photo**: Receipt from vendor
2. **Vendor Payment Slip**: Proof payer paid the vendor
3. **Transfer Slip**: Proof user paid back the payer

## Development Guidelines

### Running Tests
```bash
npm test                  # Run all tests
npm run test:coverage    # Run with coverage
npm run typecheck        # Type check only
```

### Local Development
```bash
npm run dev              # Start local dev server with hot reload
```

### Deployment
```bash
npm run deploy           # Deploy to Cloudflare Workers
```

### Database Schema Changes
If you modify `schema.sql`:
```bash
npx wrangler d1 execute raswise_db --file=./schema.sql
```

## API Architecture

### Authentication
All API requests use Telegram Web App authentication:
- Frontend sends `X-Telegram-Init-Data` header
- Backend validates signature using bot token
- User identity verified via HMAC-SHA256

### Key Endpoints
- `GET /api/user-groups` - Get user's groups
- `GET /api/group-users` - Get registered users in a group
- `GET /api/unpaid-expenses` - Get unpaid expenses for a user
- `POST /api/add-expense` - Create a new expense
- `POST /api/mark-paid` - Mark an expense as paid
- `GET /api/group-settings` - Get group settings
- `POST /api/update-currency` - Update group currency

## Important Considerations

### When Making Changes

1. **Mini App Files** (`public/*.html`):
   - No back button on main menu (app.html uses `setupCloseButton()`)
   - All other pages use `setupBackButton(url)`
   - Account numbers have click-to-copy functionality

2. **Database Changes** (`src/db.ts`):
   - All queries use prepared statements (SQL injection safe)
   - Timezone offsets stored as integers
   - Currency symbols stored per group

3. **API Handlers** (`src/api-handlers.ts`):
   - Always validate Telegram auth
   - Check user registration before operations
   - Return proper error messages

4. **Tests**:
   - Must maintain 98%+ coverage
   - Use Miniflare for realistic Cloudflare environment
   - Test all new database methods

### Code Style

- Use TypeScript strict mode
- Prefer `const` over `let`
- Use async/await (no promises chains)
- Add JSDoc comments for public functions
- Keep functions small and focused

### Commit Messages

Follow this format:
```
<type>: <description>

[optional body]

🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>
```

Types: feat, fix, refactor, docs, test, chore

## Common Tasks

### Adding a New API Endpoint

1. Add handler in `src/api-handlers.ts`
2. Add route in `src/index.ts`
3. Add types in `src/types.ts` if needed
4. Add tests in `src/test/`
5. Update README.md API documentation

### Adding a New Mini App Page

1. Create HTML file in `public/`
2. Use `miniapp.css` for styling
3. Use `miniapp.js` utilities
4. Add navigation from `app.html`
5. Implement authentication check
6. Add back button with `setupBackButton()`

### Modifying Database Schema

1. Update `schema.sql`
2. Add/update methods in `src/db.ts`
3. Update types in `src/types.ts`
4. Add tests in `src/test/db.test.ts`
5. Run migration on production D1

## Security Checklist

- [ ] No SQL injection (use prepared statements)
- [ ] Validate Telegram auth on all API endpoints
- [ ] No XSS vulnerabilities in HTML
- [ ] No sensitive data in git history
- [ ] Environment variables for secrets
- [ ] Input validation on all user inputs
- [ ] Rate limiting on API endpoints (if needed)
- [ ] Proper CORS headers

## Deployment Checklist

Before deploying:
- [ ] All tests pass (`npm test`)
- [ ] Type checking passes (`npm run typecheck`)
- [ ] Production `wrangler.toml` is local only
- [ ] Database migrations applied
- [ ] Secrets are set (`wrangler secret list`)
- [ ] R2 bucket is configured
- [ ] Bot webhook is set correctly

## Need Help?

- **README.md** - User documentation and setup guide
- **src/types.ts** - TypeScript type definitions
- **schema.sql** - Database structure
- **package.json** - Available npm scripts
- **Tests** - Usage examples and expected behavior

## Testing Strategy

### Unit Tests
- `src/test/utils.test.ts` - Utility functions
- `src/test/db.test.ts` - Database operations
- `src/test/telegram-auth.test.ts` - Authentication

### Integration Tests
- `src/test/reminders.test.ts` - Reminder system

### Coverage Goals
- Overall: 98%+
- Core modules (db, utils): 100%
- API handlers: 95%+

---

**Remember**: This is a production application handling real financial data. Always prioritize:
1. **Security** - No vulnerabilities
2. **Privacy** - DMs for sensitive data
3. **Reliability** - Comprehensive testing
4. **User Experience** - Intuitive Mini App interface
