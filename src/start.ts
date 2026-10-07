import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";

import { renderErrorPage } from "./lib/error-page";
import { getToken } from "./lib/session-client";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

/**
 * SECURITY FIX (2026-10): document responses carry a Content-Security-Policy that blocks
 * loading scripts from any domain other than this one — the explicit ask was "يمنع scripts
 * من دومينات خارجية". `script-src`/`style-src` keep 'unsafe-inline' because TanStack Start's
 * own hydration bootstrap script and this app's Tailwind/Radix/Recharts inline `<style>` tags
 * (e.g. src/components/ui/chart.tsx's `dangerouslySetInnerHTML`, which only ever injects
 * developer-defined CSS variable values, never user data) need it — tightening those further
 * is a separate, riskier change this fix does not attempt. `connect-src 'self'` is correct and
 * tight: the browser never talks to Supabase directly (see src/lib/supabase-server.ts), only
 * to this same origin's server functions.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
  setResponseHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  setResponseHeader("X-Content-Type-Options", "nosniff");
  setResponseHeader("X-Frame-Options", "DENY");
  setResponseHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  return next();
});

/**
 * SECURITY FIX (2026-10): every server function call now carries the signed session token
 * (sessionStorage via session-client.ts) as an `Authorization: Bearer <token>` header,
 * attached here once for ALL server functions — no call site needs to pass it manually. The
 * server side of the check lives in `requireSession()` (src/lib/session.server.ts), read via
 * `getRequestHeader("authorization")`. This only runs client-side (`.client()`); there is
 * deliberately no `.server()` hook here — trusting a client-asserted identity server-side is
 * exactly the bug this fix closes, so identity is always re-derived from the verified token
 * inside each handler, never attached to request context here.
 */
const authHeaderMiddleware = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const token = getToken();
  return next(token ? { headers: { Authorization: `Bearer ${token}` } } : {});
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, securityHeadersMiddleware, csrfMiddleware],
  functionMiddleware: [authHeaderMiddleware],
}));
