import { createServerFn } from "@tanstack/react-start";

import { requirePlatformAdmin } from "@/lib/session.server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

/**
 * PLATFORM_CLIENT_MANAGEMENT_SPEC.md — server functions behind `/platform/clients`.
 *
 * SECURITY FIX (2026-10): every function here used to call `assertPlatformCaller(identifier)`,
 * which trusted a plain `identifier` string sent by the browser. They now call
 * `requirePlatformAdmin()` (src/lib/session.server.ts), which derives the caller's identity
 * from a signed, server-verified bearer token instead — a client can no longer claim to be
 * the platform admin by sending an arbitrary string.
 */
const PLATFORM_CENTER_ID = "platform";

interface ClientCenterRow {
  id: string;
  name: string;
  branch: string;
  slug: string | null;
  accent_color: string | null;
  joined_at: string;
  expires_at: string;
  status: "active" | "paused";
}

export interface ClientListItem extends ClientCenterRow {
  ownerIdentifier: string | null;
  /** §3-4 — latest `accounts.last_login_at` across every account under this center, or null if none has ever logged in. */
  lastActivityAt: string | null;
}

/** §2 — "كل العملاء": every real client (never the reserved "platform" row itself). */
export const fetchClients = createServerFn({ method: "GET" })
  .handler(async (): Promise<ClientListItem[]> => {
    await requirePlatformAdmin();
    const supabase = getSupabaseAdmin();

    const { data: centers, error: centersError } = await supabase
      .from("centers")
      .select("id, name, branch, slug, accent_color, joined_at, expires_at, status")
      .neq("id", PLATFORM_CENTER_ID)
      .order("joined_at", { ascending: false });
    if (centersError) throw new Error(centersError.message);

    const centerIds = (centers ?? []).map((c) => c.id);
    const { data: accounts, error: accountsError } =
      centerIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("accounts")
            .select("center_id, role, identifier, last_login_at")
            .in("center_id", centerIds);
    if (accountsError) throw new Error(accountsError.message);

    return (centers ?? []).map((c) => {
      const centerAccounts = (accounts ?? []).filter((a) => a.center_id === c.id);
      const owner = centerAccounts.find((a) => a.role === "owner");
      const lastActivityAt = centerAccounts.reduce<string | null>((latest, a) => {
        if (!a.last_login_at) return latest;
        if (!latest || a.last_login_at > latest) return a.last_login_at as string;
        return latest;
      }, null);
      return { ...c, ownerIdentifier: owner?.identifier ?? null, lastActivityAt };
    });
  });

/**
 * §2 "آلية الإيقاف/التشغيل" — flips `status` only, never touches any other row. A paused
 * center's data stays exactly as-is; `signIn` (auth-functions.server.ts) is what actually
 * rejects logins for it.
 */
export const setClientStatus = createServerFn({ method: "POST" })
  .validator((data: { centerId: string; status: "active" | "paused" }) => data)
  .handler(async ({ data }) => {
    await requirePlatformAdmin();
    if (data.centerId === PLATFORM_CENTER_ID) {
      throw new Error("لا يمكن تغيير حالة حساب إدارة المنصة نفسه");
    }
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("centers")
      .update({ status: data.status })
      .eq("id", data.centerId);
    if (error) throw new Error(error.message);
  });

/**
 * بيانات دخول المالك (الكود/identifier) محفوظة أصلاً وباستمرار في `accounts` منذ لحظة
 * `createCenter` (صفحة /platform/new-center كانت تعرضها مرة واحدة بس عند الإنشاء ثم تضيع
 * بعد أي refresh). هذه الدالة تسمح لصاحب المنصة بمراجعة الكود في أي وقت لاحق من
 * /platform/clients بدل الاعتماد على نسخه فوراً وقت الإنشاء.
 *
 * SECURITY FIX (2026-10): **لا ترجع كلمة السر إطلاقاً بعد اليوم** — ولا حتى من عمود
 * `password` القديم (طلب صريح: "ميرجعش العمود القديم في أي دالة"، بغضّ النظر عن كونه
 * مشفَّر أو لسه نص صريح لهذا الحساب بعينه). كلمة السر الصريحة تظهر **مرة واحدة فقط** لحظة
 * `createCenter` نفسها (نتيجة الإنشاء)، ومن بعدها غير قابلة للاسترجاع من أي مكان — نفس مبدأ
 * تشفير الباسوردات، مش قصور في هذه الدالة.
 */
export const fetchClientOwnerCredentials = createServerFn({ method: "POST" })
  .validator((data: { centerId: string }) => data)
  .handler(async ({ data }) => {
    await requirePlatformAdmin();
    const supabase = getSupabaseAdmin();
    const { data: account, error } = await supabase
      .from("accounts")
      .select("identifier")
      .eq("center_id", data.centerId)
      .eq("role", "owner")
      .maybeSingle<{ identifier: string }>();
    if (error) throw new Error(error.message);
    if (!account) throw new Error("لا يوجد حساب مالك لهذا العميل");
    return account;
  });

/** §3-2 — adds a month/year on top of the center's *current* `expires_at`, not from `now()`. */
export const extendClientSubscription = createServerFn({ method: "POST" })
  .validator((data: { centerId: string; unit: "month" | "year" }) => data)
  .handler(async ({ data }) => {
    await requirePlatformAdmin();
    const supabase = getSupabaseAdmin();
    const { data: center, error: fetchError } = await supabase
      .from("centers")
      .select("expires_at")
      .eq("id", data.centerId)
      .single();
    if (fetchError || !center) throw new Error("العميل غير موجود");

    const next = new Date(center.expires_at as string);
    if (data.unit === "month") next.setMonth(next.getMonth() + 1);
    else next.setFullYear(next.getFullYear() + 1);

    const { error } = await supabase
      .from("centers")
      .update({ expires_at: next.toISOString() })
      .eq("id", data.centerId);
    if (error) throw new Error(error.message);
    return { expiresAt: next.toISOString() };
  });
