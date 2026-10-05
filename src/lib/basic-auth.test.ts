// Basic-auth header parsing for the optional dashboard password. Run: npx tsx --test src/lib/basic-auth.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { basicAuthPassword, checkBasicAuth, safeEqual } from "./basic-auth";

const basic = (userAndPassword: string) => `Basic ${Buffer.from(userAndPassword, "utf8").toString("base64")}`;

test("basicAuthPassword: takes the password, ignores the username", () => {
  assert.equal(basicAuthPassword(basic("kevin:test123")), "test123");
  assert.equal(basicAuthPassword(basic("anyone at all:test123")), "test123");
  assert.equal(basicAuthPassword(basic(":test123")), "test123", "empty username");
  assert.equal(basicAuthPassword(basic("kevin:")), "", "empty password");
});

test("basicAuthPassword: only the first colon separates; unicode survives", () => {
  assert.equal(basicAuthPassword(basic("kevin:pa:ss:word")), "pa:ss:word");
  assert.equal(basicAuthPassword(basic("kevin:pässwörd 🍕")), "pässwörd 🍕");
});

test("basicAuthPassword: scheme is case-insensitive, surrounding whitespace is fine", () => {
  const b64 = Buffer.from("u:p").toString("base64");
  assert.equal(basicAuthPassword(`basic ${b64}`), "p");
  assert.equal(basicAuthPassword(`  BASIC   ${b64}  `), "p");
});

test("basicAuthPassword: missing or malformed headers give null", () => {
  assert.equal(basicAuthPassword(null), null);
  assert.equal(basicAuthPassword(undefined), null);
  assert.equal(basicAuthPassword(""), null);
  assert.equal(basicAuthPassword("Basic"), null);
  assert.equal(basicAuthPassword("Basic !!!not-base64!!!"), null);
  assert.equal(basicAuthPassword("Bearer abc123"), null);
  assert.equal(basicAuthPassword(basic("no-colon-here")), null);
  assert.equal(basicAuthPassword(`${basic("u:p")} extra`), null);
});

test("safeEqual: equal strings only, any lengths", () => {
  assert.equal(safeEqual("test123", "test123"), true);
  assert.equal(safeEqual("test123", "test124"), false);
  assert.equal(safeEqual("test123", "test1234"), false);
  assert.equal(safeEqual("", ""), true);
  assert.equal(safeEqual("", "x"), false);
});

test("checkBasicAuth: right password with any username; wrong, missing or empty never pass", () => {
  assert.equal(checkBasicAuth(basic("any:test123"), "test123"), true);
  assert.equal(checkBasicAuth(basic("someone-else:test123"), "test123"), true);
  assert.equal(checkBasicAuth(basic("any:Test123"), "test123"), false, "case-sensitive");
  assert.equal(checkBasicAuth(basic("any:test123 "), "test123"), false);
  assert.equal(checkBasicAuth(basic("test123:any"), "test123"), false, "password in the username slot");
  assert.equal(checkBasicAuth(null, "test123"), false);
  assert.equal(checkBasicAuth("Bearer test123", "test123"), false);
  assert.equal(checkBasicAuth(basic("any:"), ""), false, "an empty configured password matches nothing");
  assert.equal(checkBasicAuth(basic("any:x"), undefined), false);
});
