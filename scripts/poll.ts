// Local dev: long polling instead of the webhook. Run `npm run poll` (deletes any webhook first).
import { bot } from "../src/channels/telegram";

const b = bot();
await b.api.deleteWebhook();
console.log("Kevin is polling. Say 'kevin hi' in your group.");
await b.start();
