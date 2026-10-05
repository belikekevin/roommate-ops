// Telegram webhook. Register it after each deploy with `npm run telegram:webhook` (setWebhook -> $APP_URL/api/telegram).
// When TELEGRAM_WEBHOOK_SECRET is set, grammY rejects updates that don't carry it as Telegram's secret token.
import { webhookCallback } from "grammy";
import { bot } from "@/channels/telegram";

export const runtime = "nodejs";

const handle = webhookCallback(bot(), "std/http", {
  secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
  timeoutMilliseconds: 55_000, // agent turns can take a while
  onTimeout: "return",
});

export const POST = (req: Request) => handle(req);
