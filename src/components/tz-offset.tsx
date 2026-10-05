"use client";
// Hidden form field carrying the browser's UTC offset (minutes, as Date#getTimezoneOffset) so a server action can turn a
// zone-less <input type="datetime-local"> value into the instant the user meant. See localDateTimeToDate().
import { useEffect, useState } from "react";

export function TzOffset() {
  const [minutes, setMinutes] = useState<number | null>(null);
  useEffect(() => setMinutes(new Date().getTimezoneOffset()), []);
  return <input type="hidden" name="tzOffset" value={minutes ?? ""} />;
}

/** "2026-10-05T21:00" + the browser's offset -> the UTC instant. Falls back to the server's zone when the offset is missing. */
export function localDateTimeToDate(value: string, tzOffsetMinutes: unknown): Date {
  const raw = value.trim();
  const offset = Number(tzOffsetMinutes);
  if (!raw || !Number.isFinite(offset) || tzOffsetMinutes === "" || tzOffsetMinutes == null) return new Date(raw);
  const asUtc = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) ? `${raw}:00Z` : `${raw}Z`);
  return new Date(asUtc.getTime() + offset * 60_000);
}
