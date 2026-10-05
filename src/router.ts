// Plain code decides whether Kevin speaks; every message is logged either way.
//
// How Kevin decides to talk (policy in router-policy.ts, facts from chat_log):
//   1. Hard triggers always get a reply: voice note, reply to one of his messages, @mention, or the word "kevin".
//   2. Attention window: for 3 minutes after Kevin last replied in a chat, up to 3 follow-up messages are shown to
//      him with permission to answer "[silent]". He answers if it continues the conversation or is something he can
//      act on ("and 2 bags of chips too"), and stays quiet for roommate chatter. A "[silent]" reply is not logged.
//   3. Otherwise the message is logged as context and Kevin says nothing.
// Scheduled posts (reminders, report, mail) go straight to telegram.send and are not logged, so they never open a
// window. The dashboard's /api/chat calls askKevin directly and is never silent.
import type { IncomingMessage, Outgoing } from "@/channels/types";
import { householdForTelegramChat, linkTelegram } from "@/services/members";
import { humanMessagesSince, lastKevinReplyAt, logMessage, recentChatter } from "@/services/chatlog";
import { askKevin } from "@/agent/kevin";
import { decideReply, parseSilent, type Decision } from "./router-policy";

/** Hard triggers: Kevin always answers these (rule 1 above). */
function isHardTrigger(msg: IncomingMessage): boolean {
  return !!(msg.isVoice || msg.isReplyToKevin || msg.mentionsKevin || /\bkevin\b/i.test(msg.text));
}

export async function handleIncoming(msg: IncomingMessage): Promise<Outgoing | null> {
  const house = await householdForTelegramChat(msg.chatId, msg.chatTitle);
  const member = await linkTelegram(house.id, msg.userId, msg.userName);
  await logMessage(house.id, member.id, msg.isVoice ? `(voice) ${msg.text}` : msg.text);

  let decision: Decision = "reply";
  if (!isHardTrigger(msg)) {
    const lastKevinAt = await lastKevinReplyAt(house.id);
    // Counted after the log above, so this includes the current message (see router-policy.ts).
    const humanSinceKevin = lastKevinAt ? await humanMessagesSince(house.id, lastKevinAt) : 0;
    decision = decideReply({ hardTrigger: false, lastKevinAt, humanSinceKevin });
  }
  if (decision === "ignore") return null;

  const chatter = await recentChatter(house.id);
  const raw = await askKevin(
    { householdId: house.id, actorId: member.id, source: "chat" },
    `${msg.isVoice ? `[voice note from ${member.name}]` : `[${member.name}]`} ${msg.text}`,
    chatter.slice(0, -1), // everything before this message
    { mayStaySilent: decision === "maybe" },
  );

  let out = raw;
  const text = parseSilent(raw.text);
  if (text === null) {
    if (decision === "maybe") return null; // Kevin chose silence: nothing sent, nothing logged, window not refreshed
    out = { ...raw, text: "👍" }; // by-name call: never post the literal token; acknowledge instead
  } else {
    out = { ...raw, text };
  }
  await logMessage(house.id, null, out.text);
  return out;
}
