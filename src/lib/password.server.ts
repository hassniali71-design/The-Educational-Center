/**
 * SECURITY FIX (2026-10): passwords used to be stored and compared as plain text in
 * `accounts.password`. New/updated passwords are now hashed with PBKDF2-SHA256 (Web Crypto —
 * works unmodified on Cloudflare Workers and Node, no new dependency) and stored in the new
 * `accounts.password_hash` column (migration 0038). The old `password` column is left in
 * place — see auth-functions.server.ts's `signIn` for the one-time, login-triggered upgrade
 * path from plaintext to hash.
 */

const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;
const PREFIX = "pbkdf2";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    keyMaterial,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

/** Hashes a plaintext password into the stored `pbkdf2$<iterations>$<saltB64>$<hashB64>` format. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `${PREFIX}$${ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

/** Constant-time-ish comparison (XOR over every byte, regardless of early mismatch) to avoid leaking length/content via timing. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Verifies a plaintext password against a `pbkdf2$...` stored hash. Returns false for any malformed hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== PREFIX) return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  try {
    const salt = base64ToBytes(parts[2]!);
    const expected = base64ToBytes(parts[3]!);
    const actual = await derive(password, salt, iterations);
    return bytesEqual(actual, expected);
  } catch {
    return false;
  }
}

/** True for a value already in the `pbkdf2$...` format produced by `hashPassword`. */
export function isHashedPassword(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith(`${PREFIX}$`);
}
