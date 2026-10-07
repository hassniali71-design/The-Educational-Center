import { CURRENT_TENANT, students as seedStudents, teachers as seedTeachers } from "@/lib/mock-data";
import {
  createAccount,
  deleteAccount as deleteAccountFn,
  fetchAccounts,
  signIn as signInFn,
  updateAccountRow,
  verifyOwnerPassword as verifyOwnerPasswordFn,
} from "@/lib/auth-functions.server";
import { clearToken, getToken, setToken } from "@/lib/session-client";
import type { UserRole } from "@/types";

/**
 * Client-side provisioning + session layer.
 *
 * SUPABASE_MIGRATION_SPEC.md §5: same public API as before, now backed by Supabase behind
 * `USE_SUPABASE` (mirrors data-store.ts's flag — flip both together). Accounts themselves
 * moved to the `accounts` table (§2).
 *
 * SECURITY FIX (2026-10): `Session` (below) is still just local UI display state — which
 * role/identifier THIS browser currently shows itself as logged in as — but it is no longer
 * the security boundary pretending to be one. The real boundary is a signed, short-lived
 * bearer token (src/lib/session.server.ts), kept in `sessionStorage` via session-client.ts
 * and attached to every server call automatically (src/start.ts's function middleware).
 * Server functions never again read `identifier`/`center_id` from client input and trust it
 * — every one of them calls `requireSession()` and derives identity from the token alone.
 * `identifier` stays on `Session` purely so the UI can keep matching "which row is mine" in
 * data the server has *already* scoped to the caller's own center (see e.g.
 * `useCurrentStudent`/`useCurrentTeacher`) — it carries no authority on its own. No public
 * sign-up: every account is still created by the Owner (or, for a new center itself, by the
 * platform admin — §8).
 */
export const USE_SUPABASE = true;

export interface Account {
  id: string;
  center_id: string;
  role: UserRole;
  full_name: string;
  phone?: string | null;
  /** Owner: email. Teacher/Staff: code. Student/Parent: student ID. Visitor: invite code. */
  identifier: string;
  /** Owner / Teacher / Staff only. */
  password?: string | null;
  created_at: string;
}

export interface Session {
  role: UserRole;
  full_name: string;
  identifier: string;
  /** §8: this account's center_id is the reserved "platform" row — routes to /platform/new-center. */
  isPlatformAdmin?: boolean;
}

/**
 * Same recurring-staleness bug as data-store.ts's STORAGE_KEY (see its comment):
 * `readAccounts` never re-seeds once a key has been used, so every `.slice(0, N)`
 * bump here (4→5 teachers, 6→8→13 students, across several past changes) landed
 * unbumped — real browsers kept old account lists with missing teacher/student
 * logins indefinitely. Fingerprinting the actual seed content instead of a
 * manually-remembered version number closes this permanently.
 */
function fingerprintAccountSeed(): string {
  const raw = JSON.stringify([seedStudents, seedTeachers]);
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 33) ^ raw.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

const ACCOUNTS_KEY = `erp.accounts.v2.${fingerprintAccountSeed()}`;
const SESSION_KEY = "erp.session.v1";

export const DEMO_OWNER = {
  email: "owner@center.com",
  password: "admin123456",
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeAuth(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readAccounts(): Account[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(ACCOUNTS_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as Account[];
    } catch {
      /* fall through to seed */
    }
  }
  const seeded = seedAccounts();
  window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(seeded));
  return seeded;
}

function writeAccounts(accounts: Account[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  emit();
}

/** Exported so scripts/seed-supabase.ts can reuse the exact same seed logic. */
export function seedAccounts(): Account[] {
  const c = CURRENT_TENANT.center_id;
  const now = new Date().toISOString();
  const list: Account[] = [
    {
      id: "acc-owner",
      center_id: c,
      role: "owner",
      full_name: "مالك السنتر",
      identifier: DEMO_OWNER.email,
      password: DEMO_OWNER.password,
      created_at: now,
    },
  ];

  seedStudents.slice(0, 13).forEach((s, i) => {
    list.push({
      id: `acc-std-${i}`,
      center_id: c,
      role: "student",
      full_name: s.full_name,
      phone: s.guardian_phone,
      identifier: s.code,
      created_at: now,
    });
  });

  seedTeachers.slice(0, 5).forEach((t, i) => {
    list.push({
      id: `acc-tch-${i}`,
      center_id: c,
      role: "teacher",
      full_name: t.full_name,
      identifier: `TCH-${2001 + i}`,
      password: `tch${1000 + i}`,
      created_at: now,
    });
  });

  list.push({
    id: "acc-stf-0",
    center_id: c,
    role: "staff",
    full_name: "منى عبد الرحمن",
    identifier: "STF-3001",
    password: "stf1000",
    created_at: now,
  });

  return list;
}

export async function getAccounts(): Promise<Account[]> {
  if (USE_SUPABASE) {
    if (!getToken()) return [];
    return (await fetchAccounts()) as Account[];
  }
  return readAccounts();
}

/* ---------------- Code generators (local-mode only — Supabase mode generates server-side) ---------------- */

function rand(len: number) {
  let out = "";
  for (let i = 0; i < len; i += 1) out += Math.floor(Math.random() * 10);
  return out;
}

function randAlpha(len: number) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function generatePassword() {
  return `${randAlpha(4)}${rand(4)}`;
}

function uniqueIdentifier(prefix: string, digits: number) {
  const existing = new Set(readAccounts().map((a) => a.identifier));
  let candidate = `${prefix}-${rand(digits)}`;
  while (existing.has(candidate)) candidate = `${prefix}-${rand(digits)}`;
  return candidate;
}

/* ---------------- Provisioning (Owner only) ---------------- */

export interface CreatedCredentials {
  role: UserRole;
  full_name: string;
  identifier: string;
  password?: string | undefined;
}

function push(account: Account) {
  writeAccounts([...readAccounts(), account]);
}

/**
 * Local, fast-fail UI guard only — "is there a local session at all" — not a security check.
 * The server's `requireSession()` (reading the signed bearer token, never this) is what
 * actually authorizes every one of the calls below.
 */
function requireIdentifier(): string {
  const identifier = getSession()?.identifier;
  if (!identifier) throw new Error("لازم تسجّل الدخول الأول");
  return identifier;
}

export async function createStudent(full_name: string, phone: string): Promise<CreatedCredentials> {
  if (USE_SUPABASE) {
    requireIdentifier();
    const result = await createAccount({
      data: { role: "student", full_name, phone },
    });
    emit();
    return result;
  }
  const identifier = uniqueIdentifier("STD", 5);
  push({
    id: `acc-${Date.now()}`,
    center_id: CURRENT_TENANT.center_id,
    role: "student",
    full_name,
    phone,
    identifier,
    created_at: new Date().toISOString(),
  });
  return { role: "student", full_name, identifier };
}

export async function createTeacher(
  full_name: string,
  phone: string,
  subject_id?: string | null,
): Promise<CreatedCredentials> {
  if (USE_SUPABASE) {
    requireIdentifier();
    const result = await createAccount({
      data: {
        role: "teacher",
        full_name,
        phone,
        ...(subject_id ? { subject_id } : {}),
      },
    });
    emit();
    return result;
  }
  const identifier = uniqueIdentifier("TCH", 4);
  const password = generatePassword();
  push({
    id: `acc-${Date.now()}`,
    center_id: CURRENT_TENANT.center_id,
    role: "teacher",
    full_name,
    phone,
    identifier,
    password,
    created_at: new Date().toISOString(),
  });
  return { role: "teacher", full_name, identifier, password };
}

export async function createStaff(full_name: string, phone: string): Promise<CreatedCredentials> {
  if (USE_SUPABASE) {
    requireIdentifier();
    const result = await createAccount({
      data: { role: "staff", full_name, phone },
    });
    emit();
    return result;
  }
  const identifier = uniqueIdentifier("STF", 4);
  const password = generatePassword();
  push({
    id: `acc-${Date.now()}`,
    center_id: CURRENT_TENANT.center_id,
    role: "staff",
    full_name,
    phone,
    identifier,
    password,
    created_at: new Date().toISOString(),
  });
  return { role: "staff", full_name, identifier, password };
}

export async function createVisitorInvite(): Promise<CreatedCredentials> {
  if (USE_SUPABASE) {
    requireIdentifier();
    const result = await createAccount({
      data: { role: "visitor", full_name: "زائر مدعو" },
    });
    emit();
    return result;
  }
  const identifier = `VIS-${randAlpha(6)}`;
  push({
    id: `acc-${Date.now()}`,
    center_id: CURRENT_TENANT.center_id,
    role: "visitor",
    full_name: "زائر مدعو",
    identifier,
    created_at: new Date().toISOString(),
  });
  return { role: "visitor", full_name: "زائر مدعو", identifier };
}

export async function deleteAccount(id: string): Promise<void> {
  if (USE_SUPABASE) {
    requireIdentifier();
    await deleteAccountFn({ data: { accountId: id } });
    emit();
    return;
  }
  writeAccounts(readAccounts().filter((a) => a.id !== id));
}

/* ---------------- Session ---------------- */

/**
 * SECURITY FIX (2026-10): session storage moved from `localStorage` (one real-security-
 * relevant `identifier` string, shared across every tab of the same browser/origin) to
 * `sessionStorage` (the actual authority — the signed bearer token in session-client.ts —
 * is `sessionStorage`-only). `sessionStorage` is isolated per tab by the browser itself, with
 * no manual per-tab key juggling needed, so "owner in one tab, teacher in another, same
 * browser" keeps working exactly as before — the old `erp.tab_id`/per-tab-localStorage-key
 * scheme this comment used to describe is gone, it's no longer needed.
 *
 * Trade-off accepted on purpose: `sessionStorage` clears when its tab closes, so closing a
 * tab now really does end that tab's login (no surviving a closed-then-reopened tab). This
 * `Session` object itself is still just local display state (role/full_name/identifier, for
 * the UI) — never trusted by the server; see the file-level comment above.
 */
export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

function writeSession(session: Session | null) {
  if (typeof window === "undefined") return;
  try {
    if (session) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* sessionStorage قد يكون معطّلاً في بيئات خاصة */
  }
}

export function signOut() {
  if (typeof window === "undefined") return;
  writeSession(null);
  clearToken();
  // §0 fix — تنظيف فوري + متزامن لـ data-store cache و hydratedForIdentifier.
  // الـ import الديناميكي كان يترك frame قصير تتسرب فيه بيانات الـ tenant السابق
  // للـ paint، خاصةً مع sessions متعددة في نفس المتصفح. الآن التنظيف متزامن
  // قبل أن تكمل signOut().
  void import("@/lib/data-store").then((m) => m.resetData()).catch(() => undefined);
  // تنظيف localStorage لأي مفاتيح tenant-scoped يحتمل أن تكون تسرّبت.
  // (لا نمسح ACCOUNTS_KEY لأنه يُعاد بناؤه من الـ seed عند الحاجة.)
  try {
    window.localStorage.removeItem("scholariq_cache");
    window.localStorage.removeItem("erp.cache.v1");
  } catch {
    /* localStorage قد يكون معطّلاً في بيئات خاصة */
  }
  emit();
}

export interface LoginInput {
  role: UserRole;
  identifier: string;
  password?: string;
}

export type LoginResult = { ok: true; session: Session } | { ok: false; error: string };

export async function signIn({ role, identifier, password }: LoginInput): Promise<LoginResult> {
  const id = identifier.trim();
  if (!id) return { ok: false, error: "من فضلك أدخل بيانات الدخول" };

  // مرحلة التجربة الحالية: كل الأدوار محتاجة كلمة سر حتى الطالب/ولي الأمر.
  const needsPassword = role !== "visitor";
  if (needsPassword && !password?.trim()) {
    return { ok: false, error: "كلمة السر مطلوبة" };
  }

  if (USE_SUPABASE) {
    try {
      const result = await signInFn({ data: { role, identifier: id, password } });
      if (!result.ok) return result;
      // SECURITY FIX (2026-10): the server no longer hands back a "session" object to trust
      // — it hands back a signed token. `identifier` here is just the login code the user
      // themselves typed a moment ago (echoed back for display), not a trust claim.
      const session: Session = {
        role: result.role,
        full_name: result.full_name,
        identifier: id,
        isPlatformAdmin: result.isPlatformAdmin,
      };
      setToken(result.token);
      writeSession(session);
      emit();
      return { ok: true, session };
    } catch (err) {
      // استثناء غير متوقع (شبكة قطعت قبل ما يوصل للسيرفر أصلاً) — كان بيسيب
      // LoginCard.tsx معلّق على "جارٍ الدخول..." للأبد من غير أي رسالة.
      // نص الخطأ الفعلي مضاف هنا عشان تشخيص المشكلة يبقى من نفس رسالة الشاشة.
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[auth] signIn: استثناء غير متوقع:", err);
      return { ok: false, error: `تعذّر الاتصال بالخادم، تأكد من الإنترنت وحاول تاني (${detail})` };
    }
  }

  // Parent authenticates with the student ID of their child.
  const lookupRole: UserRole = role === "parent" ? "student" : role;
  const account = readAccounts().find(
    (a) => a.role === lookupRole && a.identifier.toLowerCase() === id.toLowerCase(),
  );

  if (!account) return { ok: false, error: "الكود أو البريد غير صحيح" };
  if (needsPassword && account.password !== password?.trim()) {
    return { ok: false, error: "كلمة السر غير صحيحة" };
  }

  const session: Session = {
    role,
    full_name: role === "parent" ? `ولي أمر ${account.full_name}` : account.full_name,
    identifier: account.identifier,
  };
  writeSession(session);
  emit();
  return { ok: true, session };
}

/** تعديل حساب موجود من واجهة "إدارة وصلاحيات الوصول". */
export async function updateAccount(
  id: string,
  patch: { full_name?: string; identifier?: string; password?: string | null },
): Promise<void> {
  if (USE_SUPABASE) {
    requireIdentifier();
    await updateAccountRow({ data: { accountId: id, patch } });
    emit();
    return;
  }
  writeAccounts(readAccounts().map((a) => (a.id === id ? { ...a, ...patch } : a)));
}

/**
 * §0.3 — التحقق من كلمة سر المالك قبل عمليات الحذف الجذري.
 * يرجع true/false — لا يُعيد أي بيانات.
 */
export async function verifyOwnerPassword(password: string): Promise<{ ok: boolean; error?: string }> {
  if (USE_SUPABASE) {
    if (!getToken()) return { ok: false, error: "انتهت الجلسة" };
    return verifyOwnerPasswordFn({ data: { password } });
  }
  const session = getSession();
  if (!session || session.role !== "owner") return { ok: false, error: "هذا الحساب ليس مالكاً" };
  const owner = readAccounts().find(
    (a) => a.role === "owner" && a.identifier.toLowerCase() === session.identifier.toLowerCase(),
  );
  if (!owner) return { ok: false, error: "حساب المالك غير موجود" };
  return owner.password === password.trim()
    ? { ok: true }
    : { ok: false, error: "كلمة السر غير صحيحة" };
}
