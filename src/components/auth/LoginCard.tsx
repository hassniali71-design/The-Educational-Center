import { useNavigate } from "@tanstack/react-router";
import { GraduationCap, LogIn, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ROLES, ROLE_ORDER } from "@/config/roles";
import { getSession, signIn } from "@/lib/auth";
import { DEFAULT_TENANT_ACCENT, getTenantPaletteVars } from "@/lib/tenant-colors";
import type { UserRole } from "@/types";

const identifierLabel: Record<UserRole, string> = {
  owner: "كود المالك",
  teacher: "كود المدرس",
  staff: "كود الموظف",
  student: "كود الطالب (Student ID)",
  parent: "كود الطالب الخاص بابنك",
  visitor: "كود دعوة الزائر",
};

const identifierPlaceholder: Record<UserRole, string> = {
  owner: "OWN-AHFO",
  teacher: "TCH-AHFO",
  staff: "STF-AHFO",
  student: "STD-AHFO",
  parent: "STD-AHFO",
  visitor: "VIS-ABC123",
};

function needsPassword(role: UserRole) {
  // مرحلة التجربة الحالية: كل الأدوار محتاجة كلمة سر حتى الطالب/ولي الأمر.
  return role !== "visitor";
}

/**
 * SUPABASE_MIGRATION_SPEC.md §11-ب — the actual login form, shared by both entry points:
 * `/` (generic, `branding` omitted) and `/login/$slug` (a specific client's own link, name +
 * accent_color known before auth). Same form/logic either way — only the header changes.
 */
export function LoginCard({
  branding,
}: {
  branding?: { name: string; accentColor: string | null } | null;
}) {
  const navigate = useNavigate();
  const [role, setRole] = useState<UserRole>("owner");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  /**
   * الجذر الحقيقي لشكوى "لازم أسجل دخول كل مرة": الجلسة كانت بالفعل محفوظة
   * بدون انتهاء صلاحية في localStorage (auth.ts)، لكن صفحة الدخول نفسها كانت
   * دايماً بترسم الفورم من غير ما تتحقق أصلاً لو فيه جلسة محفوظة سليمة. أي حد
   * يفتح رابط الدخول تاني (حتى لو نفس الجهاز، نفس اليوزر) كان يضطر يكتب بياناته
   * من الأول في كل مرة. الحل من جذوره هنا: تحقق مرة واحدة عند فتح الصفحة، ولو
   * فيه جلسة، ادخل على طول بدون ما تعرض الفورم إطلاقاً.
   */
  useEffect(() => {
    const existing = getSession();
    if (existing) {
      void navigate({
        to: existing.isPlatformAdmin ? "/platform/new-center" : ROLES[existing.role].home,
        replace: true,
      });
      return;
    }
    setCheckingSession(false);
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await signIn({ role, identifier, password });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      setError(null);
      toast.success(`مرحباً ${result.session.full_name}`);
      navigate({ to: result.session.isPlatformAdmin ? "/platform/new-center" : ROLES[role].home });
    } catch {
      // خط دفاع أخير — signIn() نفسها بقت بتمسك أي استثناء وترجّع {ok:false}،
      // لكن لو حصل استثناء غير متوقع هنا برضو، الزرار يفضل قابل لإعادة المحاولة
      // بدل ما يعلّق على "جارٍ الدخول..." للأبد بدون أي رسالة.
      const message = "تعذّر الاتصال بالخادم، تأكد من الإنترنت وحاول تاني";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingSession) {
    return (
      <div dir="rtl" className="flex min-h-screen items-center justify-center bg-canvas">
        <p className="text-base font-black text-muted-foreground">جارٍ التحقق من الجلسة…</p>
      </div>
    );
  }

  return (
    <div
      dir="rtl"
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-4 py-10"
      style={getTenantPaletteVars(branding?.accentColor) as React.CSSProperties}
    >
      <div className="w-full max-w-md">
        {/* رسالة ترحيب عامة على مستوى الشركة/النظام — ثابتة، مش مرتبطة بلون أي سنتر. */}
        <div className="mb-4 flex flex-col items-center gap-3 text-center">
          <p className="text-sm font-black text-foreground">
            مرحباً بكم في نظام سبّورة لإدارة السناتر التعليمية
          </p>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 rounded-xl border-2 border-border bg-card px-3 py-1.5">
              <GraduationCap className="size-4 text-primary" />
              <span className="text-sm font-black text-foreground">سبّورة</span>
            </span>
            <span className="text-muted-foreground">×</span>
            <span className="rounded-xl border-2 border-border bg-card px-3 py-1.5 text-sm font-black text-primary">
              حلول
            </span>
          </div>
        </div>

        <div className="card-crisp overflow-hidden">
          <div
            className="flex flex-col items-center gap-3 px-6 py-8 text-navy-foreground"
            style={{ backgroundColor: branding?.accentColor ?? DEFAULT_TENANT_ACCENT }}
          >
            <span className="flex size-16 items-center justify-center rounded-2xl bg-white/15">
              <GraduationCap className="size-9" />
            </span>
            <div className="text-center">
              {/* رسالة ترحيب منفصلة عن ترحيب الشركة فوق — دي خاصة بالسنتر نفسه.
                  Generic `/` is shared by every client (§8), فبتفضل عامة؛ `/login/$slug`
                  بيعرف السنتر بالظبط فيعرض اسمه الحقيقي هنا. */}
              <p className="text-xl font-black">
                {branding?.name ? `أهلاً بك في ${branding.name}` : "منصة إدارة السناتر التعليمية"}
              </p>
            </div>
            <p className="rounded-xl bg-white/10 px-3 py-1.5 text-[11px] font-black text-white/80">
              نظام ERP و LMS متكامل — دخول آمن بدون تسجيل ذاتي
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 p-6">
            <h1 className="text-2xl font-black text-foreground">تسجيل الدخول</h1>

            <div className="space-y-1.5">
              <label htmlFor="role" className="block text-sm font-extrabold text-foreground">
                نوع الحساب
              </label>
              <select
                id="role"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value as UserRole);
                  setIdentifier("");
                  setPassword("");
                  setError(null);
                }}
                className="w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-base font-extrabold text-foreground outline-none focus:border-primary"
              >
                {ROLE_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {ROLES[r].title}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="identifier" className="block text-sm font-extrabold text-foreground">
                {identifierLabel[role]}
              </label>
              <input
                id="identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={identifierPlaceholder[role]}
                autoComplete="off"
                className="w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-base font-extrabold text-foreground outline-none placeholder:font-bold placeholder:text-muted-foreground focus:border-primary"
              />
            </div>

            {needsPassword(role) ? (
              <div className="space-y-1.5">
                <label htmlFor="password" className="block text-sm font-extrabold text-foreground">
                  كلمة السر
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-base font-extrabold text-foreground outline-none focus:border-primary"
                />
              </div>
            ) : null}

            {error ? (
              <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-extrabold text-destructive">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-base font-black text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <LogIn className="size-5" />
              {submitting ? "جارٍ الدخول…" : "دخول"}
            </button>

            <p className="flex items-center justify-center gap-1.5 text-center text-xs font-bold text-muted-foreground">
              <ShieldCheck className="size-4" />
              الحسابات تُنشأ من لوحة المالك فقط — لا يوجد تسجيل ذاتي
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
