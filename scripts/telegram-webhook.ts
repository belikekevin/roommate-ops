// Register (or remove) Kevin's Telegram webhook. Run after every deploy, and again after `npm run poll` (poll deletes it).
//   npx tsx --env-file=.env scripts/telegram-webhook.ts            setWebhook -> $APP_URL/api/telegram
//   npx tsx --env-file=.env scripts/telegram-webhook.ts --delete   deleteWebhook (before local `npm run poll`)
// Reads TELEGRAM_BOT_TOKEN, APP_URL, TELEGRAM_WEBHOOK_SECRET. Always ends by printing getWebhookInfo. Exits 1 on failure.

type TgResponse<T> = { ok: true; result: T } | { ok: false; error_code?: number; description?: string };

type WebhookInfo = {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  allowed_updates?: string[];
};

const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
const appUrl = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
const deleting = process.argv.includes("--delete");

function fail(message: string): never {
  console.error(`telegram-webhook: ${message}`);
  process.exit(1);
}

async function call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as TgResponse<T> | null;
  if (!data) throw new Error(`${method}: non-JSON response (HTTP ${res.status})`);
  if (!data.ok) throw new Error(`${method}: ${data.error_code ?? res.status} ${data.description ?? res.statusText}`);
  return data.result;
}

async function printWebhookInfo(): Promise<WebhookInfo> {
  const info = await call<WebhookInfo>("getWebhookInfo");
  console.log("getWebhookInfo:");
  console.log(`  url:                  ${info.url || "(none — polling mode)"}`);
  console.log(`  pending_update_count: ${info.pending_update_count}`);
  console.log(`  last_error_message:   ${info.last_error_message ?? "(none)"}`);
  if (info.last_error_date) console.log(`  last_error_date:      ${new Date(info.last_error_date * 1000).toISOString()}`);
  return info;
}

// ---- validate env before touching Telegram ----
// Bot tokens look like "123456789:AAH...". Telegram's secret_token allows 1-256 chars of A-Z a-z 0-9 _ -.
if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) fail("TELEGRAM_BOT_TOKEN is missing or malformed (expected 123456:ABC... from @BotFather).");
if (!deleting) {
  if (!/^https:\/\/[^/\s]+/.test(appUrl)) fail(`APP_URL must be a public https URL (got "${appUrl || "(empty)"}").`);
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) fail("TELEGRAM_WEBHOOK_SECRET must be 1-256 chars of A-Z a-z 0-9 _ - (Telegram's rule).");
  if (secret === "change-me") console.warn("telegram-webhook: TELEGRAM_WEBHOOK_SECRET is still 'change-me'. Fine for a demo, change it before anything real.");
}

let exitCode = 0;
try {
  const me = await call<{ username: string }>("getMe");
  console.log(`bot: @${me.username}`);

  if (deleting) {
    await call<boolean>("deleteWebhook", { drop_pending_updates: false });
    console.log("deleteWebhook: ok (long polling via `npm run poll` can take over now)");
  } else {
    const url = `${appUrl}/api/telegram`;
    await call<boolean>("setWebhook", {
      url,
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    });
    console.log(`setWebhook: ok -> ${url}`);
  }
} catch (err) {
  console.error(`telegram-webhook: ${err instanceof Error ? err.message : String(err)}`);
  exitCode = 1;
}

// Always finish with the live state, whatever happened above.
try {
  const info = await printWebhookInfo();
  const expected = deleting ? "" : `${appUrl}/api/telegram`;
  if (info.url !== expected) {
    console.error(`telegram-webhook: webhook url is "${info.url}", expected "${expected || "(none)"}".`);
    exitCode = 1;
  }
} catch (err) {
  console.error(`telegram-webhook: ${err instanceof Error ? err.message : String(err)}`);
  exitCode = 1;
}

process.exit(exitCode);

// No imports above, so this makes the file a module (top-level await).
export {};
