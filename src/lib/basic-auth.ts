// HTTP Basic auth helpers for the optional dashboard password (src/proxy.ts). Pure: a header in, a yes/no out.
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The password in an `Authorization: Basic <base64("user:password")>` header, or null when the header is missing or
 * malformed. The username is ignored; everything after the first colon is the password (passwords may contain colons).
 */
export function basicAuthPassword(header: string | null | undefined): string | null {
  const match = /^\s*Basic\s+([A-Za-z0-9+/]+={0,2})\s*$/i.exec(header ?? "");
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon === -1 ? null : decoded.slice(colon + 1);
}

/**
 * Constant-time string comparison. Both sides are hashed first, so the comparison always runs over 32 bytes and its
 * timing reveals neither the length nor a matching prefix of the expected value.
 */
export function safeEqual(a: string, b: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** True when the Authorization header carries exactly `password`. An empty or unset `password` never matches. */
export function checkBasicAuth(header: string | null | undefined, password: string | null | undefined): boolean {
  if (!password) return false;
  const given = basicAuthPassword(header);
  return given !== null && safeEqual(given, password);
}
