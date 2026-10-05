// grammY bot: webhook in prod (/api/telegram), long polling in dev (npm run poll).
import { Bot, InlineKeyboard, type Context } from "grammy";
import { getHousehold } from "@/services/members";
import { handleIncoming } from "@/router";
import { transcribe } from "@/lib/voice";
import type { Channel, IncomingMessage, Outgoing } from "./types";

let _bot: Bot | null = null;

export function bot(): Bot {
  if (_bot) return _bot;
  const b = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
  const username = (process.env.TELEGRAM_BOT_USERNAME ?? "").toLowerCase();

  b.on(["message:text", "message:voice"], async (tg) => {
    const m = tg.message;
    let text = m.text ?? "";
    if (m.voice) {
      const file = await tg.getFile();
      const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      // Telegram voice notes are ogg/opus; pass the mime so transcribe() picks the right input_audio format.
      text = await transcribe(await (await fetch(url)).arrayBuffer(), { mime: m.voice.mime_type ?? "audio/ogg", filename: file.file_path });
    }
    const msg: IncomingMessage = {
      channel: "telegram",
      chatId: String(m.chat.id),
      chatTitle: "title" in m.chat ? m.chat.title : undefined,
      userId: String(m.from.id),
      userName: m.from.first_name,
      text,
      isVoice: !!m.voice,
      isReplyToKevin: m.reply_to_message?.from?.id === tg.me.id,
      mentionsKevin: !!username && text.toLowerCase().includes(`@${username}`),
    };
    const out = await handleIncoming(msg);
    if (out) await reply(tg, out);
  });

  b.catch((err) => console.error("telegram error", err.error));
  _bot = b;
  return b;
}

function keyboard(out: Outgoing) {
  if (!out.buttons?.length) return undefined;
  const kb = new InlineKeyboard();
  for (const btn of out.buttons) kb.url(btn.text, btn.url).row();
  return kb;
}

async function reply(tg: Context, out: Outgoing) {
  await tg.reply(out.text, { reply_markup: keyboard(out) });
}

export const telegram: Channel = {
  async send(householdId, out) {
    const house = await getHousehold(householdId);
    if (!house?.telegramChatId) return;
    await bot().api.sendMessage(house.telegramChatId, out.text, { reply_markup: keyboard(out) });
  },
};
