import { getRequestHeader, setResponseStatus } from "@tanstack/react-start/server";

import type { UserRole } from "@/types";

/**
 * SECURITY FIX (2026-10): replaces the old scheme where every server function trusted a
 * plain `identifier` string sent by the browser (read from `localStorage`) to resolve
 * `center_id` — anyone could edit that string in devtools and act as any account. The
 * browser now carries a short-lived, HMAC-signed bearer token (in `sessionStorage`, sent as
 * an `Authorization: Bearer <token>` header — see src/start.ts's function middleware) and
 * every server function calls `requireSession()` as its very first line to get back the
 * server-verified `{ accountId, centerId, role }`. No server function may read `identifier`
 * or `center_id` from client input and trust it for authorization ever again.
 */

export interface SessionPayload {
  accountId: string;
  centerId: string;
  role: UserRole;
  /** issued-at, unix seconds */
  iat: number;
  /** expiry, unix seconds */
  exp: number;
}

const TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12 hours, per spec

function getSessionSecret(): string {
  const cfEnv = (globalThis as { __env__?: Record<string, string | undefined> }).__env__;
  const secret = cfEnv?.["SESSION_SECRET"] ?? process.env["SESSION_SECRET"];
  if (!secret) {
    throw new Error(
      "SESSION_SECRET غير مضبوط في متغيرات البيئة — لازم يتضبط قبل أي تسجيل دخول.",
    );
  }
  return secret;
}

/* ---------------- base64url + HMAC helpers (Web Crypto — works on Cloudflare Workers and Node) ---------------- */

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let cachedKey: CryptoKey | null = null;
let cachedKeySecret: string | null = null;

async function getHmacKey(): Promise<CryptoKey> {
  const secret = getSessionSecret();
  if (cachedKey && cachedKeySecret === secret) return cachedKey;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  cachedKey = key;
  cachedKeySecret = secret;
  return key;
}

/* ---------------- sign / verify ---------------- */

export async function signSessionToken(input: {
  accountId: string;
  centerId: string;
  role: UserRole;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    accountId: input.accountId,
    centerId: input.centerId,
    role: input.role,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const payloadB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await getHmacKey();
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  const sigB64 = bytesToBase64Url(new Uint8Array(signature));
  return `${payloadB64}.${sigB64}`;
}

/** Returns the verified payload, or null for any malformed/unsigned/expired/tampered token. */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts as [string, string];
  try {
    const key = await getHmacKey();
    const signatureOk = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(sigB64) as BufferSource,
      new TextEncoder().encode(payloadB64) as BufferSource,
    );
    if (!signatureOk) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64))) as SessionPayload;
    if (
      typeof payload.accountId !== "string" ||
      typeof payload.centerId !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ---------------- request-scoped guards ---------------- */

/**
 * First line of every server function. Reads the `Authorization: Bearer <token>` header of
 * the current request (TanStack Start exposes it via request-scoped context — no need to
 * thread the request through manually), verifies its signature and expiry, and returns the
 * server-trusted identity. Throws (with the response status already set to 401) on anything
 * wrong — missing header, malformed token, bad signature, or expired token. Callers must
 * never fall back to any client-supplied `identifier`/`center_id` field when this throws.
 */
export async function requireSession(): Promise<SessionPayload> {
  const header = getRequestHeader("authorization");
  const token = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
  const payload = token ? await verifySessionToken(token) : null;
  if (!payload) {
    setResponseStatus(401);
    throw new Error("جلسة غير صالحة أو منتهية — سجّل الدخول من جديد.");
  }
  return payload;
}

/** For the handful of platform-admin-only operations (onboarding a new client, managing clients). */
export async function requirePlatformAdmin(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.centerId !== "platform") {
    setResponseStatus(403);
    throw new Error("هذا الحساب غير مصرَّح له بهذه العملية");
  }
  return session;
}

/** Throws 403 if the session's role isn't one of `roles`. Use for the explicitly sensitive operations. */
export function requireRole(session: SessionPayload, roles: readonly UserRole[]): void {
  if (!roles.includes(session.role)) {
    setResponseStatus(403);
    throw new Error("هذا الحساب غير مصرَّح له بهذه العملية");
  }
}
