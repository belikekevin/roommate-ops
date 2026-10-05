# Security

## Reporting a vulnerability

Please do not open a public issue. Open a private security advisory on the GitHub repository instead:
<https://github.com/belikekevin/roommate-ops/security/advisories/new>

Say what you found, how to reproduce it and what an attacker could do with it. You will get a reply there.

## What to know before you deploy

- **There are no user accounts.** The dashboard acts as whichever roommate is selected in the "Acting as" picker.
  Anyone who can open it can read and change everything for the household.
- **Set `DASHBOARD_PASSWORD` on any deployment that is reachable from the internet.** It puts HTTP Basic auth
  (any username, that password) in front of the dashboard and `/api/chat`. Without it there is no access control.
- **Webhook routes stay open and rely on their own secrets.** Set `TELEGRAM_WEBHOOK_SECRET` to a long random
  value so only Telegram can call `/api/telegram`. If you register the AgentMail webhook, set
  `AGENTMAIL_WEBHOOK_SECRET` so deliveries to `/api/agentmail` must be signed.
- **The Telegram group is the trust boundary for chat.** Every member of the group can use every feature,
  including sending email from Kevin's inbox and reading replies.
- **Never commit `.env`.** Keep tokens, connection strings, chat ids and real email addresses out of code, docs
  and seed data. If a secret leaks, rotate it at the provider.
