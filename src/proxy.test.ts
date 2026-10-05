// The optional dashboard password gate: which paths it covers and what it answers.
// Run: npx tsx --test src/proxy.test.ts
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";

const basic = (userAndPassword: string) => `Basic ${Buffer.from(userAndPassword).toString("base64")}`;
const request = (path: string, authorization?: string) =>
  new NextRequest(`https://kevin.example${path}`, authorization ? { headers: { authorization } } : undefined);

// Next anchors a matcher source to the whole path, so for this pattern (a literal "/" and one regex group) the
// equivalent plain RegExp is ^source$. This pins the exemption list; the running server is the real check.
describe("matcher", () => {
  const [source] = config.matcher;
  const matches = (path: string) => new RegExp(`^${source}$`).test(path);

  test("covers every dashboard page and /api/chat", () => {
    for (const path of ["/", "/money", "/cart", "/cart/checkout", "/chores", "/reminders", "/inbox", "/upkeep", "/members", "/nope", "/api/chat"]) {
      assert.equal(matches(path), true, path);
    }
  });

  test("leaves the webhooks and build assets open", () => {
    for (const path of ["/api/telegram", "/api/agentmail", "/_next/static/chunks/main.js", "/_next/static/css/app.css", "/_next/image", "/favicon.ico"]) {
      assert.equal(matches(path), false, path);
    }
  });

  test("the webhook exemptions are exact paths, not prefixes", () => {
    for (const path of ["/api/telegram-admin", "/api/telegram/extra", "/api/agentmail2", "/api", "/favicon.ico.html"]) {
      assert.equal(matches(path), true, path);
    }
  });
});

describe("proxy", () => {
  const saved = process.env.DASHBOARD_PASSWORD;
  afterEach(() => {
    if (saved === undefined) delete process.env.DASHBOARD_PASSWORD;
    else process.env.DASHBOARD_PASSWORD = saved;
  });
  // NextResponse.next() marks a pass-through with this header; a response without it is what the client receives.
  const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

  test("no DASHBOARD_PASSWORD (unset or empty): everything passes, with or without credentials", () => {
    delete process.env.DASHBOARD_PASSWORD;
    assert.ok(passedThrough(proxy(request("/"))));
    assert.ok(passedThrough(proxy(request("/api/chat", basic("any:whatever")))));
    process.env.DASHBOARD_PASSWORD = "";
    assert.ok(passedThrough(proxy(request("/money"))));
  });

  test("password set: no or wrong credentials get a 401 Basic challenge", () => {
    process.env.DASHBOARD_PASSWORD = "test123";
    for (const auth of [undefined, basic("any:nope"), basic("test123:any"), "Bearer test123"]) {
      const res = proxy(request("/", auth));
      assert.equal(res.status, 401);
      assert.match(res.headers.get("www-authenticate") ?? "", /^Basic realm="Kevin"/);
      assert.ok(!passedThrough(res));
    }
  });

  test("password set: the right password passes with any username", () => {
    process.env.DASHBOARD_PASSWORD = "test123";
    assert.ok(passedThrough(proxy(request("/", basic("any:test123")))));
    assert.ok(passedThrough(proxy(request("/api/chat", basic("someone-else:test123")))));
  });
});
