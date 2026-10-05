// Optional password gate for public deployments (Next.js Proxy, the convention formerly called middleware).
//
// Off by default: with DASHBOARD_PASSWORD unset or empty every request passes through untouched. When it is set, every
// dashboard page, the server actions behind their forms, and /api/chat require HTTP Basic auth with that password (any
// username). It is one shared password for the household, not per-user accounts: once in, the "Acting as" picker
// still lets you act as any roommate (see lib/dashboard.ts).
//
// Left open on purpose (see `matcher`):
//   /api/telegram, /api/agentmail   webhooks called by Telegram and AgentMail, which authenticate with their own secrets
//                                   (TELEGRAM_WEBHOOK_SECRET, AGENTMAIL_WEBHOOK_SECRET)
//   /_next/*, /favicon.ico          build assets; nothing household-specific
import { NextResponse, type NextRequest } from "next/server";
import { checkBasicAuth } from "@/lib/basic-auth";

export function proxy(request: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password || checkBasicAuth(request.headers.get("authorization"), password)) return NextResponse.next();
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Kevin", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!api/telegram$|api/agentmail$|_next/|favicon\\.ico$).*)"],
};
