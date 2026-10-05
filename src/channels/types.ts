// Channel contract: the agent never imports Telegram. A channel normalizes messages in and sends replies out.
export type IncomingMessage = {
  channel: "telegram";
  chatId: string;
  chatTitle?: string;
  userId: string;
  userName: string;
  text: string; // for voice notes: the transcript
  isVoice?: boolean;
  isReplyToKevin?: boolean;
  mentionsKevin?: boolean; // @bot mention (the router also checks the word "kevin")
};

export type Button = { text: string; url: string };
export type Outgoing = { text: string; buttons?: Button[] };

export interface Channel {
  /** Post into a household's group chat. Used by the scheduler and webhooks. */
  send(householdId: string, msg: Outgoing): Promise<void>;
}
