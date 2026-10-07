import { createFileRoute, redirect } from "@tanstack/react-router";
import { BadgeCheck, Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BrandLogo } from "@/components/BrandLogo";
import { PlatformHeader } from "@/components/platform/PlatformHeader";
import { createCenter } from "@/lib/auth-functions.server";
import { getSession } from "@/lib/auth";
import { fetchCenterDataForAdmin } from "@/lib/data-functions.server";
import { downloadCenterExcel } from "@/lib/export-excel";
import { TENANT_ACCENT_COLORS } from "@/lib/tenant-colors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/platform/new-center")({
  /**
   * SUPABASE_MIGRATION_SPEC.md §8 — for "المالك العام للنظام", not any client. Route-level
   * gate is the first layer (kept consistent with how every other portal route in this app
   * already checks `getSession()`); `createCenter`'s own server-side check (only the seeded
   * "platform" center's account may call it) is the real, unspoofable one — see
   * src/lib/auth-functions.server.ts.
   */
  beforeLoad: () => {
    if (typeof window !== "undefined") {
      const session = getSession();
      if (!session?.isPlatformAdmin) {
        throw redirect({ to: "/" });
      }
    }
  },
  head: () => ({
    meta: [
      { title: "إضافة عميل جديد — إدارة المنصة" },
      { name: "description", content: "إنشاء سنتر جديد وحساب المالك الخاص به." },
    ],
  }),
  component: NewCenterPage,
});

interface CreatedCenter {
  centerId: string;
  identifier: string;
  password: string;
  slug: string;
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
  toast.success(`تم نسخ: ${text}`);
}

function NewCenterPage() {
  const [centerName, setCenterName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [accentColor, setAccentColor] = useState<string>(TENANT_ACCENT_COLORS[0].hex);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedCenter | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // السيرفر بيستمد الهوية من التوكن الموقَّع تلقائياً (requirePlatformAdmin) — هذا فحص
    // محلي سريع فقط لعرض رسالة واضحة بدل انتظار رد الشبكة لو الجلسة منتهية.
    if (!getSession()) {
      toast.error("جلسة غير صالحة — سجّل الدخول من جديد");
      return;
    }
    if (!centerName.trim() || !phone.trim() || !address.trim()) {
      toast.error("من فضلك أدخل كل البيانات");
      return;
    }
    setSubmitting(true);
    try {
      const result = await createCenter({
        data: {
          centerName: centerName.trim(),
          phone: phone.trim(),
          address: address.trim(),
          accentColor,
        },
      });
      setCreated(result);
      setCenterName("");
      setPhone("");
      setAddress("");
      setAccentColor(TENANT_ACCENT_COLORS[0].hex);
      toast.success("تم إنشاء العميل الجديد بنجاح");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ أثناء إنشاء العميل");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-canvas">
      <BrandLogo />
      <PlatformHeader
        title="إدارة المنصة — إضافة عميل جديد"
        subtitle="هذه الشاشة لصاحب المنصة فقط، وليست جزءاً من لوحات العملاء"
        active="new-center"
      />

      <main className="mx-auto max-w-lg px-6 py-10">
        <form onSubmit={handleSubmit} className="card-crisp space-y-4 p-6">
          <h1 className="text-xl font-black text-foreground">بيانات العميل الجديد</h1>
          <p className="text-sm font-bold text-muted-foreground">
            الرابط اللي بيتدّى للعميل موحّد لكل العملاء — الفرق بينهم بيانات الدخول فقط.
          </p>

          <div className="space-y-1.5">
            <label className="block text-sm font-extrabold text-foreground">اسم السنتر</label>
            <input
              value={centerName}
              onChange={(e) => setCenterName(e.target.value)}
              placeholder="مثال: سنتر المستقبل التعليمي"
              className="w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-base font-extrabold text-foreground outline-none placeholder:font-bold placeholder:text-muted-foreground focus:border-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-extrabold text-foreground">رقم التليفون</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="01000000000"
              className="w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-base font-extrabold text-foreground outline-none placeholder:font-bold placeholder:text-muted-foreground focus:border-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-extrabold text-foreground">العنوان</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="المدينة — الفرع"
              className="w-full rounded-xl border-2 border-border bg-background px-4 py-3 text-base font-extrabold text-foreground outline-none placeholder:font-bold placeholder:text-muted-foreground focus:border-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-extrabold text-foreground">
              لون السايدبار المميز
            </label>
            <div className="flex flex-wrap gap-2">
              {TENANT_ACCENT_COLORS.map((color) => (
                <button
                  key={color.key}
                  type="button"
                  onClick={() => setAccentColor(color.hex)}
                  title={color.label}
                  style={{ backgroundColor: color.hex }}
                  className={cn(
                    "flex size-11 items-center justify-center rounded-xl border-2 transition-transform",
                    accentColor === color.hex
                      ? "scale-110 border-foreground"
                      : "border-transparent",
                  )}
                >
                  {accentColor === color.hex ? <Check className="size-5 text-white" /> : null}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-navy px-5 py-3.5 text-base font-black text-navy-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? "جارٍ الإنشاء…" : "إنشاء العميل"}
          </button>
        </form>

        {created ? (
          <div className="card-crisp mt-6 space-y-3 border-2 border-success p-5">
            <p className="flex items-center gap-2 text-sm font-black text-success">
              <BadgeCheck className="size-4" />
              تم إنشاء العميل — بيانات دخول المالك:
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => copy(created.identifier)}
                className="flex items-center gap-2 rounded-lg border-2 border-border bg-background px-3 py-2 font-mono text-sm font-black text-foreground"
              >
                <Copy className="size-4" /> {created.identifier}
              </button>
              <button
                type="button"
                onClick={() => copy(created.password)}
                className="flex items-center gap-2 rounded-lg border-2 border-border bg-background px-3 py-2 font-mono text-sm font-black text-foreground"
              >
                <Copy className="size-4" /> {created.password}
              </button>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-bold text-muted-foreground">
                رابط الدخول المخصص لهذا العميل — سلّمه ده بدل الرابط العام:
              </p>
              <button
                type="button"
                onClick={() =>
                  copy(
                    `${typeof window !== "undefined" ? window.location.origin : ""}/login/${created.slug}`,
                  )
                }
                dir="ltr"
                className="flex w-full items-center justify-between gap-2 rounded-lg border-2 border-border bg-background px-3 py-2 text-left font-mono text-xs font-black text-foreground"
              >
                <span className="truncate">
                  {typeof window !== "undefined" ? window.location.origin : ""}/login/{created.slug}
                </span>
                <Copy className="size-4 shrink-0" />
              </button>
            </div>
          </div>
        ) : null}

        <ExportCenterTool />
      </main>
    </div>
  );
}

/**
 * SUPABASE_MIGRATION_SPEC.md §10-ب — admin-only, not visible to any client: pull one
 * center's data on demand by its id, for a quick recovery without restoring the whole
 * database. `fetchCenterDataForAdmin` re-checks the caller is the platform account itself.
 */
function ExportCenterTool() {
  const [targetCenterId, setTargetCenterId] = useState("");
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    if (!getSession() || !targetCenterId.trim()) {
      toast.error("من فضلك أدخل معرّف العميل (center_id)");
      return;
    }
    setExporting(true);
    try {
      const data = await fetchCenterDataForAdmin({
        data: { targetCenterId: targetCenterId.trim() },
      });
      downloadCenterExcel({
        centerName: targetCenterId.trim(),
        students: data.students as never,
        teachers: data.teachers as never,
        groups: data.groups as never,
        attendanceRecords: data.attendanceRecords as never,
        payments: data.payments as never,
        quizResults: data.quizResults as never,
        homeworkTasks: data.homeworkTasks as never,
      });
      toast.success("تم تحضير ملف تصدير العميل");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ أثناء التصدير");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="card-crisp mt-10 space-y-3 p-6">
      <h2 className="text-lg font-black text-foreground">
        أداة إدارية — تصدير بيانات عميل واحد بعينه
      </h2>
      <p className="text-sm font-bold text-muted-foreground">
        لاسترجاع سريع لعميل واحد متأثر بمشكلة، بدون الحاجة لاسترجاع قاعدة البيانات كاملة. أدخل الـ
        center_id الخاص به.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          value={targetCenterId}
          onChange={(e) => setTargetCenterId(e.target.value)}
          placeholder="ctr-0001"
          className="flex-1 rounded-xl border-2 border-border bg-background px-4 py-3 font-mono text-sm font-extrabold text-foreground outline-none placeholder:font-bold placeholder:text-muted-foreground focus:border-primary"
        />
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={exporting}
          className="flex items-center gap-2 rounded-xl bg-navy px-5 py-3 text-sm font-black text-navy-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          <Download className="size-4" />
          {exporting ? "جارٍ التصدير…" : "تصدير"}
        </button>
      </div>
    </div>
  );
}
