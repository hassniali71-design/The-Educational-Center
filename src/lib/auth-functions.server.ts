import { createServerFn } from "@tanstack/react-start";

import { buildNameCode, generateSimplePassword, ROLE_PREFIX } from "@/lib/identifier-gen";
import {
  gradeSubjects as seedGradeSubjects,
  grades as seedGrades,
  subjects as seedSubjects,
} from "@/lib/mock-data";
import { hashPassword, isHashedPassword, verifyPassword } from "@/lib/password.server";
import { requirePlatformAdmin, requireRole, requireSession, signSessionToken } from "@/lib/session.server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { TENANT_ACCENT_COLORS } from "@/lib/tenant-colors";
import type { UserRole } from "@/types";

/**
 * SUPABASE_MIGRATION_SPEC.md §2 — `accounts` mirrors auth.ts's current `Account` shape
 * exactly, just backed by Supabase instead of localStorage now.
 *
 * SECURITY FIX (2026-10): added `password_hash` (migration 0038). `password` is kept for the
 * one-time, login-triggered upgrade path in `signIn` below — new/updated passwords never
 * write it anymore (see `createAccount`/`updateAccountRow`), only `password_hash`.
 */
interface AccountRow {
  id: string;
  center_id: string;
  role: UserRole;
  full_name: string;
  phone: string | null;
  identifier: string;
  password: string | null;
  password_hash?: string | null;
  created_at: string;
  /** PLATFORM_CLIENT_MANAGEMENT_SPEC.md §3-4 — set on every successful signIn (below). */
  last_login_at?: string | null;
}

/** Columns safe to hand back to any client — never `password` or `password_hash`. */
export const PUBLIC_ACCOUNT_COLUMNS =
  "id, center_id, role, full_name, phone, identifier, created_at, last_login_at";

export interface PasswordCheckResult {
  ok: boolean;
  /**
   * Set only when the account was still on the legacy plaintext `password` column and it just
   * matched — the caller must persist this as `password_hash` and null out `password` right
   * away (both `signIn` and `verifyOwnerPassword` do this).
   */
  upgradeHash?: string;
}

/**
 * Pure (no Supabase I/O) password check, shared by `signIn` and `verifyOwnerPassword` — kept
 * as a standalone export so it can be unit-tested without a database.
 */
export async function verifyAccountPassword(
  account: { password: string | null; password_hash?: string | null },
  typedPassword: string,
): Promise<PasswordCheckResult> {
  if (isHashedPassword(account.password_hash)) {
    return { ok: await verifyPassword(typedPassword, account.password_hash) };
  }
  if (account.password && account.password === typedPassword) {
    return { ok: true, upgradeHash: await hashPassword(typedPassword) };
  }
  return { ok: false };
}

/** §8's onboarding screen — reserved, not a real client. Seeded once, see supabase/seed/. */
const PLATFORM_CENTER_ID = "platform";

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
/**
 * كود دخول مبني على الاسم (PREFIX-XXXX) بدل أرقام عشوائية بحتة — طلب صريح
 * لمرحلة التجربة الحالية (انظر تعليق الأمان في identifier-gen.ts). التحقق
 * من التكرار حقيقي ضد Supabase (identifier فريد عالمياً عبر كل المراكز).
 */
async function uniqueFriendlyIdentifier(prefix: string, fullName: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const base = buildNameCode(fullName);
  for (let attempt = 1; attempt < 50; attempt += 1) {
    const candidate = attempt === 1 ? `${prefix}-${base}` : `${prefix}-${base}${attempt}`;
    const { data } = await supabase
      .from("accounts")
      .select("id")
      .eq("identifier", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  throw new Error("تعذّر توليد كود فريد — حاول مرة أخرى");
}

/** §11-ب — keeps Arabic letters (this is an Arabic-first product; see the admin-identifier slug just below for the same precedent), strips everything else, spaces become hyphens. */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function uniqueSlug(centerName: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const base = slugify(centerName) || "center";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${rand(4)}`;
    const { data } = await supabase
      .from("centers")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  throw new Error("تعذّر توليد رابط فريد — حاول مرة أخرى");
}

/**
 * SECURITY FIX (2026-10): this is the ONE place a client-supplied `identifier` is still
 * legitimately used — it's the login code/email being typed in, not a trust claim. Every
 * other server function derives identity from the signed token `signIn` hands back here,
 * never from a client-supplied identifier again.
 */
export const signIn = createServerFn({ method: "POST" })
  .validator((data: { role: UserRole; identifier: string; password?: string | undefined }) => data)
  .handler(async ({ data }) => {
    const identifier = data.identifier.trim();
    if (!identifier) return { ok: false as const, error: "من فضلك أدخل بيانات الدخول" };

    // مرحلة التجربة الحالية: كل الأدوار بقت محتاجة كلمة سر (حتى الطالب/ولي الأمر)
    // — طلب صريح من صاحب المشروع مع كود الدخول الجديد المبني على الاسم.
    const needsPassword = data.role !== "visitor";
    if (needsPassword && !data.password?.trim()) {
      return { ok: false as const, error: "كلمة السر مطلوبة" };
    }

    // Parent authenticates with the student ID of their child — same lookup as auth.ts.
    const lookupRole: UserRole = data.role === "parent" ? "student" : data.role;

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch (err) {
      // إعدادات الاتصال بقاعدة البيانات (ERP_SUPABASE_URL/KEY) ناقصة أو فاضية على
      // بيئة النشر — رسالة مختلفة صراحةً عن فشل الشبكة، وبتظهر نص الخطأ الحقيقي
      // على الشاشة مباشرة (بدل ما نحتاج نقرا لوجات السيرفر) عشان تتحل بسرعة.
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[auth] signIn: getSupabaseAdmin فشلت:", err);
      return { ok: false as const, error: detail };
    }

    // §0 fix — .ilike بدون تهريب كان بيسمح بمطابقة أنماط (%, _) بدل تطابق دقيق.
    // نهرّب علامات الـ wildcard الخاصة بـ ILIKE مع الحفاظ على عدم حساسية حالة الأحرف.
    const escapedIdentifier = identifier.replace(/[\\%_]/g, (ch) => `\\${ch}`);

    let account: AccountRow | null;
    try {
      const { data: found } = await supabase
        .from("accounts")
        .select("*")
        .eq("role", lookupRole)
        .ilike("identifier", escapedIdentifier)
        .maybeSingle<AccountRow>();
      account = found;
    } catch (err) {
      // تعثر شبكي/Supabase أثناء تسجيل الدخول كان بيرمي استثناء غير مُعالَج، فيعلّق
      // زر "دخول" للأبد بدون أي رسالة (setSubmitting(false) في LoginCard.tsx كان
      // بيفضل معلّق بعده) — وده كان بيتحس كإنه لازم يعيد المحاولة كذا مرة.
      // نص الخطأ الفعلي بيتضاف هنا عشان نقدر نشخّص المشكلة من نفس رسالة الشاشة.
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[auth] signIn: تعذّر الاتصال بالخادم أثناء البحث عن الحساب:", err);
      return {
        ok: false as const,
        error: `تعذّر الاتصال بالخادم، تأكد من الإنترنت وحاول تاني (${detail})`,
      };
    }

    if (!account) return { ok: false as const, error: "الكود أو البريد غير صحيح" };

    if (needsPassword) {
      const typedPassword = data.password?.trim() ?? "";
      const check = await verifyAccountPassword(account, typedPassword);
      if (!check.ok) {
        return { ok: false as const, error: "كلمة السر غير صحيحة" };
      }
      if (check.upgradeHash) {
        // SECURITY FIX (2026-10) — legacy plaintext account just matched: upgrade it to a
        // PBKDF2 hash right now so the plaintext never needs to be compared again.
        // Best-effort: a failure here must never block a valid login.
        try {
          await supabase
            .from("accounts")
            .update({ password_hash: check.upgradeHash, password: null })
            .eq("id", account.id);
        } catch (err) {
          console.error("[auth] signIn: تعذّر ترقية كلمة السر لـ hash (الدخول نجح رغم ذلك):", err);
        }
      }
    }

    /**
     * PLATFORM_CLIENT_MANAGEMENT_SPEC.md §2 — checked only after credentials verify, so a
     * paused center's status is never revealed to someone without a valid login for it.
     * "platform" itself is never paused (no UI exposes that toggle for it), so this never
     * blocks the platform admin's own login.
     */
    try {
      const { data: center } = await supabase
        .from("centers")
        .select("status")
        .eq("id", account.center_id)
        .maybeSingle();
      if (center?.status === "paused") {
        return { ok: false as const, error: "الاشتراك متوقف حالياً، تواصل مع الدعم" };
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[auth] signIn: تعذّر الاتصال بالخادم أثناء فحص حالة السنتر:", err);
      return {
        ok: false as const,
        error: `تعذّر الاتصال بالخادم، تأكد من الإنترنت وحاول تاني (${detail})`,
      };
    }

    // Best-effort — a failed timestamp write must never block a valid login.
    try {
      await supabase
        .from("accounts")
        .update({ last_login_at: new Date().toISOString() })
        .eq("id", account.id);
    } catch (err) {
      console.error("[auth] signIn: تعذّر تحديث last_login_at (تجاهل، الدخول ناجح):", err);
    }

    // SECURITY FIX (2026-10): the server is now the only thing that knows `account.id` and
    // `account.center_id` — the browser gets a signed, 12h-lived token instead, and must send
    // it back (Authorization header) on every subsequent call. It never gets to assert its
    // own `center_id` again.
    const token = await signSessionToken({
      accountId: account.id,
      centerId: account.center_id,
      role: data.role,
    });

    return {
      ok: true as const,
      token,
      full_name: data.role === "parent" ? `ولي أمر ${account.full_name}` : account.full_name,
      role: data.role,
      isPlatformAdmin: account.center_id === PLATFORM_CENTER_ID,
    };
  });

/** الدور الوحيد المسموح له يدير حسابات مركزه من "إدارة وصلاحيات الوصول" — نفس القيد الموجود فعلياً في الواجهة (nav/roles.ts) الآن مفروض على السيرفر أيضاً. */
const ACCOUNT_MANAGEMENT_ROLES: readonly UserRole[] = ["owner"];

export const fetchAccounts = createServerFn({ method: "GET" })
  .handler(async () => {
    const session = await requireSession();
    requireRole(session, ACCOUNT_MANAGEMENT_ROLES);
    const supabase = getSupabaseAdmin();
    const { data: rows, error } = await supabase
      .from("accounts")
      .select(PUBLIC_ACCOUNT_COLUMNS)
      .eq("center_id", session.centerId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []) as Omit<AccountRow, "password" | "password_hash">[];
  });

export const createAccount = createServerFn({ method: "POST" })
  .validator(
    (data: {
      role: "student" | "teacher" | "staff" | "visitor";
      full_name: string;
      phone?: string;
      honorific?: "mr" | "miss" | "mrs";
      cover_image_key?: string | null;
      subject_id?: string | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const session = await requireSession();
    requireRole(session, ACCOUNT_MANAGEMENT_ROLES);
    const supabase = getSupabaseAdmin();

    // مرحلة التجربة الحالية: كود دخول مبني على الاسم (PREFIX-XXXX) بدل أرقام عشوائية
    // بحتة، وكلمة سر 4 أرقام لكل الأدوار (حتى الطالب) — طلب صريح من صاحب المشروع،
    // انظر تعليق الأمان في identifier-gen.ts. الزائر (invite بلا كلمة سر) مستثنى.
    const needsPassword = data.role !== "visitor";

    const newIdentifier =
      data.role === "visitor"
        ? `VIS-${randAlpha(6)}`
        : await uniqueFriendlyIdentifier(ROLE_PREFIX[data.role], data.full_name);
    const password = needsPassword ? generateSimplePassword() : undefined;
    // SECURITY FIX (2026-10): only ever store the PBKDF2 hash for new accounts — `password`
    // stays null from creation onward. The plaintext is still returned once in this
    // function's result, for the owner to copy and relay to the new user right now.
    const passwordHash = password ? await hashPassword(password) : null;

    const row: AccountRow = {
      id: `acc-${Date.now()}`,
      center_id: session.centerId,
      role: data.role,
      full_name: data.full_name,
      phone: data.phone ?? null,
      identifier: newIdentifier,
      password: null,
      password_hash: passwordHash,
      created_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("accounts").insert(row);
    if (error) throw new Error(error.message);

    // ملحوظة: صف `teachers` الفعلي (المادة، الأغلفة، المراحل...) بيتعمل من
    // createTeacherRecord (data-store.ts) اللي بينده owner.access.tsx دايماً
    // فوراً بعد النداء ده — إنشاء صف teachers تاني هنا كان بيسبب صف مكرر
    // يتيم في القاعدة الحقيقية (id مختلف، بيانات فاضية) لكل مدرس جديد.

    return { role: data.role, full_name: data.full_name, identifier: newIdentifier, password };
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .validator((data: { accountId: string }) => data)
  .handler(async ({ data }) => {
    const session = await requireSession();
    requireRole(session, ACCOUNT_MANAGEMENT_ROLES);
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("accounts")
      .delete()
      .eq("id", data.accountId)
      .eq("center_id", session.centerId);
    if (error) throw new Error(error.message);
  });

/**
 * SUPABASE_MIGRATION_SPEC.md §8 — client onboarding. Deliberately reuses the existing
 * accounts/login mechanism instead of a new auth system: the caller must already be logged
 * in as the one seeded account whose `center_id` is the reserved "platform" row (never a
 * real client's center) — see supabase/seed/ for that seeded identifier/password. This is
 * an explicit, server-verified check (via the signed session token), not just a hidden route.
 */
export const createCenter = createServerFn({ method: "POST" })
  .validator(
    (data: {
      centerName: string;
      phone: string;
      address: string;
      /** §11-أ — one of TENANT_ACCENT_COLORS's hex values, never free text. */
      accentColor: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    await requirePlatformAdmin();
    if (!TENANT_ACCENT_COLORS.some((c) => c.hex === data.accentColor)) {
      throw new Error("لون غير معروف — اختر من القائمة المتاحة");
    }

    const supabase = getSupabaseAdmin();
    const newCenterId = `ctr-${Date.now()}`;
    const centerSlug = await uniqueSlug(data.centerName);
    // PLATFORM_CLIENT_MANAGEMENT_SPEC.md §1 — joined_at defaults to now() at the DB level too,
    // but expires_at (joined_at + 1 year) has no DB-side default, so it's computed explicitly
    // here from the same timestamp to keep the two in exact sync.
    const joinedAt = new Date();
    const expiresAt = new Date(joinedAt);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    const { error: centerError } = await supabase.from("centers").insert({
      id: newCenterId,
      name: data.centerName,
      branch: data.address,
      accent_color: data.accentColor,
      slug: centerSlug,
      joined_at: joinedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      status: "active",
    });
    if (centerError) throw new Error(centerError.message);

    // مرحلة التجربة الحالية: نفس شكل كود الدخول المستخدم لبقية الأدوار (OWN-XXXX)،
    // مبني من اسم السنتر نفسه (لا يوجد حقل "اسم المالك" منفصل في هذه الشاشة بعد).
    const identifier = await uniqueFriendlyIdentifier(ROLE_PREFIX.owner, data.centerName);
    const password = generateSimplePassword();
    const passwordHash = await hashPassword(password);

    const { error: accountError } = await supabase.from("accounts").insert({
      id: `acc-${Date.now()}`,
      center_id: newCenterId,
      role: "owner",
      full_name: `مالك ${data.centerName}`,
      phone: data.phone,
      identifier,
      password: null,
      password_hash: passwordHash,
      created_at: new Date().toISOString(),
    });
    if (accountError) throw new Error(accountError.message);

    /**
     * Not in §8's literal text, but its own next line says the new client immediately starts
     * adding teachers/students under their center_id "بدون أي إجراء إضافي" — with zero grades
     * or subjects seeded, the add-student/add-teacher screens would have nothing to select
     * from. Grades and subjects are standard reference data (the same Egyptian grade levels
     * every center in this system uses, per §11-ج), not something each client configures from
     * scratch, so they're seeded here the same way the demo center's are — everything else
     * (teachers, students, groups, real curriculum content) is still entirely the client's own.
     */
    const subjectIdMap = new Map(seedSubjects.map((s) => [s.id, `${newCenterId}-${s.id}`]));
    const gradeIdMap = new Map(seedGrades.map((g) => [g.id, `${newCenterId}-${g.id}`]));

    const { error: subjectsError } = await supabase.from("subjects").insert(
      seedSubjects.map((s) => ({
        id: subjectIdMap.get(s.id),
        center_id: newCenterId,
        name: s.name,
        theme_key: s.theme_key,
      })),
    );
    if (subjectsError) throw new Error(subjectsError.message);

    const { error: gradesError } = await supabase.from("grades").insert(
      seedGrades.map((g) => ({
        id: gradeIdMap.get(g.id),
        center_id: newCenterId,
        name: g.name,
        order: g.order,
      })),
    );
    if (gradesError) throw new Error(gradesError.message);

    const { error: gradeSubjectsError } = await supabase.from("grade_subjects").insert(
      seedGradeSubjects.map((gs) => ({
        id: `${newCenterId}-${gs.id}`,
        center_id: newCenterId,
        grade_id: gradeIdMap.get(gs.grade_id),
        subject_id: subjectIdMap.get(gs.subject_id),
      })),
    );
    if (gradeSubjectsError) throw new Error(gradeSubjectsError.message);

    return { centerId: newCenterId, identifier, password, slug: centerSlug };
  });

/** تعديل بيانات حساب موجود (الاسم / الكود / كلمة السر) — مقيَّد بمركز المستدعي. */
export const updateAccountRow = createServerFn({ method: "POST" })
  .validator(
    (data: {
      accountId: string;
      patch: { full_name?: string; identifier?: string; password?: string | null; phone?: string | null };
    }) => data,
  )
  .handler(async ({ data }) => {
    const session = await requireSession();
    requireRole(session, ACCOUNT_MANAGEMENT_ROLES);
    const supabase = getSupabaseAdmin();

    // SECURITY FIX (2026-10): a password change writes `password_hash` only — `password`
    // (plaintext) is actively nulled out so this account can never again be compared in
    // plaintext, even if it still had a legacy value sitting there.
    const { password: newPlainPassword, ...rest } = data.patch;
    const patch: Record<string, unknown> = { ...rest };
    if (newPlainPassword !== undefined) {
      patch["password"] = null;
      patch["password_hash"] = newPlainPassword === null ? null : await hashPassword(newPlainPassword);
    }

    const { error } = await supabase
      .from("accounts")
      .update(patch)
      .eq("id", data.accountId)
      .eq("center_id", session.centerId);
    if (error) throw new Error(error.message);
  });

/**
 * §0.3 — التحقق من كلمة سر المالك قبل أي عملية حساسة (حذف جذري، حذف الكل).
 * لا نُعيد كلمة السر — فقط true/false.
 *
 * SECURITY FIX (2026-10): يتحقق من حساب المستدعي نفسه (من الجلسة الموقَّعة) — لم يعد
 * يقبل `identifier` من العميل إطلاقاً، فمينفعش حد يتحقق من كلمة سر حساب غير حسابه.
 */
export const verifyOwnerPassword = createServerFn({ method: "POST" })
  .validator((data: { password: string }) => data)
  .handler(async ({ data }) => {
    const session = await requireSession();
    if (session.role !== "owner") {
      return { ok: false as const, error: "هذا الحساب ليس مالكاً" };
    }
    const supabase = getSupabaseAdmin();
    const { data: account } = await supabase
      .from("accounts")
      .select("id, password, password_hash")
      .eq("id", session.accountId)
      .maybeSingle<{ id: string; password: string | null; password_hash: string | null }>();
    if (!account) {
      return { ok: false as const, error: "حساب المالك غير موجود" };
    }

    const typed = data.password.trim();
    const check = await verifyAccountPassword(account, typed);
    if (!check.ok) {
      return { ok: false as const, error: "كلمة السر غير صحيحة" };
    }
    if (check.upgradeHash) {
      // ترقية فورية لـ hash — نفس منطق signIn.
      try {
        await supabase
          .from("accounts")
          .update({ password_hash: check.upgradeHash, password: null })
          .eq("id", account.id);
      } catch (err) {
        console.error("[auth] verifyOwnerPassword: تعذّر ترقية كلمة السر لـ hash:", err);
      }
    }
    return { ok: true as const };
  });

/**
 * §0.3 — الحصول على رابط القبول (slug) للسنتر الحالي — لتوليد رابط دخول خاص بالسنتر.
 * (مُكمل لـ /login/$slug إن لم يُحفظ في `cache` بعد.)
 */
export const fetchMyCenterSlug = createServerFn({ method: "GET" })
  .handler(async () => {
    const session = await requireSession();
    const supabase = getSupabaseAdmin();
    const { data: row } = await supabase
      .from("centers")
      .select("slug, name, accent_color")
      .eq("id", session.centerId)
      .maybeSingle<{ slug: string | null; name: string; accent_color: string | null }>();
    return row ?? null;
  });
