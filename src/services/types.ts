// Every service takes a Ctx first. Tools and the dashboard both build one.
export type Ctx = {
  householdId: string;
  actorId: string; // members.id of whoever is acting (sender in chat, chosen member in the UI)
  source?: "chat" | "ui";
};

export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
