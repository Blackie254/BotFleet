# BotCloud deployment guide

BotCloud contains the public storefront and a signed-in control panel for hosting WhatsApp bots. The first approved catalog item is **BLACK MD BOT** (`blackmd-01` is the prefilled instance name). Catalog repositories are selected server-side; a customer cannot substitute arbitrary code in the browser.

## What is implemented

- Clerk-powered account login and protected customer routes.
- KSh wallet with ledger entries. Paystack checkout is initialized in KES; the account is credited only after a valid signed webhook or a server-side Paystack verification.
- A KSh 50 first-month debit for each deployment and KSh 50 monthly renewals from the wallet balance.
- Heroku deployment for the approved catalog source, encrypted storage of submitted session IDs, and a safety preflight before creating a Heroku app.
- Renewal reminders sent to the verified account email when a bot is due in the next 24 hours. The reminder sweep checks every 15 minutes and uses the activity log to avoid repeat messages for the same billing period.
- Responsive light interface with high-contrast cyan/blue accents and the BLACK MD logo referenced by the bot's Heroku app manifest.

## Required hosting configuration

Copy the names in [`.env.example`](.env.example) to the server's secret manager. Do not put live values in GitHub, a client-side `VITE_` variable (except the Clerk publishable key), support messages, or this guide.

- `DATABASE_URL`: PostgreSQL connection for BotCloud's account, wallet, deployment, and activity data.
- `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`: Clerk authentication. Configure the production instance and allowed redirect/origin URLs.
- `PAYSTACK_SECRET_KEY`: Paystack server secret. Register `POST /api/payments/paystack/webhook` in Paystack and use the correct live/test environment. The handler validates the Paystack HMAC signature, KES currency, amount, and pending wallet reference.
- `HEROKU_API_KEY`: Heroku token with the required app/build/config-vars/formation permissions.
- `SESSION_SECRET`: stable random server-only key for AES-256-GCM encryption of WhatsApp session IDs stored by BotCloud. Changing it makes previously stored ciphertext unreadable.
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`: Resend key and a sender/domain verified with Resend. Email reminders remain inactive if either value is missing.
- `PUBLIC_APP_URL`: the final HTTPS origin, used in reminder emails.

The free checkout screenshot is not a production payment test. Paystack's enabled methods depend on the merchant account, transaction currency, and the channels configured in Paystack; verify M-Pesa, card, and bank methods in the merchant's own test/live checkout.

## Critical BLACK MD repository remediation required before deployment

The public `Blackie254/black-super-bot` repository currently tracks a `.Env` file and `session/creds.json`, and its public entrypoint contains a hard-coded database connection fallback. The file contents were not downloaded or disclosed during this work. Treat any credentials or WhatsApp session in that public repository as compromised: revoke/rotate them, remove the files and hard-coded fallback from Git history/current source as appropriate, and review the associated WhatsApp account and database access.

BotCloud now blocks Heroku provisioning when it finds those tracked session/environment files or the known hard-coded database-fallback pattern. This happens before any Heroku app is created; the initial wallet debit is returned through BotCloud's wallet ledger if a provisioning attempt fails. Do not remove the guard merely to make the current public repository deploy. After the repository owner has remediated the source, confirm the clean public default branch and review it before enabling launch.

## Adding more bots

For each additional bot, add its catalog metadata in `artifacts/api-server/src/lib/bot-templates.ts` and its fixed repository URL in `BOT_REPOSITORIES`. Make sure the repository owner has supplied the bot name, source repository, logo, verified pairing instructions, required Heroku configuration variables, and a safe deployment/health-check contract. Do not make the repository URL customer-editable.

## Preview and release

The current public sandbox preview is temporary and is not a production deployment. Production requires the server/database, Clerk, Paystack, Heroku, and email secrets above, a stable HTTPS domain, database schema provisioning, Paystack webhook registration, and a clean approved bot source. Use `pnpm run typecheck` and `PORT=21899 BASE_PATH=/ pnpm run build` before publishing.
