/**
 * SECURITY FIX (2026-10): the signed session token (src/lib/session.server.ts) lives in
 * `sessionStorage`, not `localStorage` — chosen explicitly (see the conversation that led
 * here) to keep the existing "multiple tabs, different roles, same browser" feature working:
 * `sessionStorage` is isolated per browsing-context (tab) by the browser itself, with no
 * per-tab key juggling needed (unlike the old `localStorage`-based scheme in auth.ts). The
 * trade-off, accepted on purpose: closing a tab ends that tab's session — a fresh login is
 * needed in a newly opened tab, same as any session-scoped token.
 *
 * This file only stores/retrieves the token string. It is attached to every server function
 * call automatically by the function middleware in src/start.ts — nothing else needs to
 * import this module.
 */

const TOKEN_KEY = "erp.session_token.v1";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* sessionStorage قد يكون معطّلاً في بيئات خاصة */
  }
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}
