import { useNavigate } from "@tanstack/react-router";
import { LogIn, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { BrandLogo } from "@/components/BrandLogo";
import { ROLES } from "@/config/roles";
import { getSession, signIn, signOut } from "@/lib/auth";

/**
 * The platform operator's own login — now the site's root (`/`), so bookmarking the base
 * Cloudflare URL always lands the operator on their own entry point, not the client-facing
 * generic login. No role selector: this page only ever authenticates the "platform" account.
 */
export function PlatformLoginCard() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  // نفس الإصلاح الجذري في LoginCard.tsx: لو فيه جلسة محفوظة أصلاً (مالك سنتر
  // حقيقي أو مشغّل المنصة)، ادخل على طول من غير ما تعرض فورم الدخول تاني.
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
    const result = await signIn({ role: "owner", identifier: email, password });
    if (!result.ok) {
      setError(result.error);
      toast.error(result.error);
      setSubmitting(false);
      return;
    }
    if (!result.session.isPlatformAdmin) {
      // signIn() already wrote a session for a real (non-platform) account — undo it, this
      // page only ever authenticates the platform operator.
      signOut();
      setError("هذا الحساب ليس حساب إدارة المنصة");
      toast.error("هذا الحساب ليس حساب إدارة المنصة");
      setSubmitting(false);
      return;
    }
    setError(null);
    toast.success("مرحباً بك في لوحة إدارة المنصة");
    void navigate({ to: "/platform/new-center" });
  }

  if (checkingSession) {
    return (
      <div dir="rtl" className="flex min-h-screen items-center justify-center bg-canvas">
        <p className="text-base font-black text-muted-foreground">جارٍ التحقق من الجلسة…</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <BrandLogo />
      <div className="w-full max-w-md">
        <div className="card-crisp overflow-hidden">
          <div className="flex flex-col items-center gap-3 bg-navy px-6 py-8 text-navy-foreground">
            <span className="flex size-16 items-center justify-center rounded-2xl bg-white/15">
              <ShieldCheck className="size-9" />
            </span>
            <p className="text-xl font-black">إدارة المنصة</p>
            <p className="rounded-xl bg-white/10 px-3 py-1.5 text-[11px] font-black text-white/80">
              دخول خاص بمشغّل المنصة — ليس للعملاء
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 p-6">
            <h1 className="text-2xl font-black text-foreground">تسجيل الدخول</h1>

            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-extrabold text-foreground">
                البريد الإلكتروني
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="username"
                className="w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-base font-extrabold text-foreground outline-none placeholder:font-bold placeholder:text-muted-foreground focus:border-primary"
              />
            </div>

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

            {error ? (
              <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-extrabold text-destructive">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-navy px-5 py-3.5 text-base font-black text-navy-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <LogIn className="size-5" />
              {submitting ? "جارٍ الدخول…" : "دخول"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
