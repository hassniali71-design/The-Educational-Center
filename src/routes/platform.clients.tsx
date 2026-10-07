import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  Ban,
  CalendarClock,
  Copy,
  Download,
  Eye,
  EyeOff,
  Play,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { BrandLogo } from "@/components/BrandLogo";
import { Panel, StatCard, StatusBadge } from "@/components/dashboard/StatCard";
import { PlatformHeader } from "@/components/platform/PlatformHeader";
import { getSession } from "@/lib/auth";
import { fetchCenterDataForAdmin } from "@/lib/data-functions.server";
import { downloadCenterExcel } from "@/lib/export-excel";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  extendClientSubscription,
  fetchClientOwnerCredentials,
  fetchClients,
  setClientStatus,
  type ClientListItem,
} from "@/lib/platform-functions.server";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/platform/clients")({
  /** Same gate as `/platform/new-center` — see its Route.beforeLoad for the reasoning. */
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
      { title: "كل العملاء — إدارة المنصة" },
      {
        name: "description",
        content: "متابعة كل عميل: الحالة، الاشتراك، آخر نشاط، وتصدير بياناته.",
      },
    ],
  }),
  component: ClientsPage,
});

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
  toast.success(`تم نسخ: ${text}`);
}

/** PLATFORM_CLIENT_MANAGEMENT_SPEC.md §2 — "أخضر → أصفر عند اقتراب الانتهاء → أحمر لو انتهى فعلاً". */
function subscriptionProgress(joinedAt: string, expiresAt: string) {
  const start = new Date(joinedAt).getTime();
  const end = new Date(expiresAt).getTime();
  const now = Date.now();
  const total = Math.max(1, end - start);
  const remaining = end - now;
  const percentRemaining = Math.max(0, Math.min(100, (remaining / total) * 100));
  const daysRemaining = Math.ceil(remaining / (1000 * 60 * 60 * 24));
  const tone: "success" | "warning" | "destructive" =
    remaining <= 0 ? "destructive" : daysRemaining <= 30 ? "warning" : "success";
  return { percentRemaining, daysRemaining, tone };
}

const progressBarTone: Record<"success" | "warning" | "destructive", string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

function ClientCard({ client, onChanged }: { client: ClientListItem; onChanged: () => void }) {
  const [busy, setBusy] = useState<"toggle" | "extend-month" | "extend-year" | "export" | null>(
    null,
  );
  // SECURITY FIX (2026-10): كلمة السر مابترجعش من السيرفر إطلاقاً بعد اليوم — الكود
  // (identifier) بس، للمراجعة. كلمة السر الصريحة تظهر مرة واحدة فقط لحظة الإنشاء.
  const [credentials, setCredentials] = useState<{ identifier: string } | null>(null);
  const [loadingCreds, setLoadingCreds] = useState(false);
  const progress = subscriptionProgress(client.joined_at, client.expires_at);
  const loginLink =
    (typeof window !== "undefined" ? window.location.origin : "") +
    (client.slug ? `/login/${client.slug}` : "");

  // السيرفر بيستمد الهوية من التوكن الموقَّع تلقائياً (requirePlatformAdmin) في كل نداء
  // تحت — مفيش حاجة نبني/نبعت identifier بعد كده، هذا فحص محلي سريع فقط للعرض.
  function requireLocalSession(): boolean {
    if (!getSession()) {
      toast.error("جلسة غير صالحة — سجّل الدخول من جديد");
      return false;
    }
    return true;
  }

  async function toggleStatus() {
    if (!requireLocalSession()) return;
    setBusy("toggle");
    try {
      const nextStatus = client.status === "active" ? "paused" : "active";
      await setClientStatus({ data: { centerId: client.id, status: nextStatus } });
      toast.success(nextStatus === "paused" ? "تم إيقاف العميل" : "تم تشغيل العميل من جديد");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ أثناء تغيير الحالة");
    } finally {
      setBusy(null);
    }
  }

  async function extend(unit: "month" | "year") {
    if (!requireLocalSession()) return;
    setBusy(unit === "month" ? "extend-month" : "extend-year");
    try {
      await extendClientSubscription({ data: { centerId: client.id, unit } });
      toast.success(unit === "month" ? "تم تمديد الاشتراك شهراً" : "تم تمديد الاشتراك سنة");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ أثناء التمديد");
    } finally {
      setBusy(null);
    }
  }

  async function toggleCredentials() {
    if (credentials) {
      setCredentials(null);
      return;
    }
    if (!requireLocalSession()) return;
    setLoadingCreds(true);
    try {
      const result = await fetchClientOwnerCredentials({
        data: { centerId: client.id },
      });
      setCredentials(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر جلب بيانات الدخول");
    } finally {
      setLoadingCreds(false);
    }
  }

  async function exportClient() {
    if (!requireLocalSession()) return;
    setBusy("export");
    try {
      const data = await fetchCenterDataForAdmin({
        data: { targetCenterId: client.id },
      });
      downloadCenterExcel({
        centerName: client.name,
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
      setBusy(null);
    }
  }

  return (
    <div className="card-crisp space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-black text-foreground">{client.name}</p>
          <p className="text-xs font-bold text-muted-foreground">{client.branch}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={client.status === "active" ? "success" : "neutral"}>
            {client.status === "active" ? "نشط" : "متوقف"}
          </StatusBadge>
          <button
            type="button"
            onClick={() => void toggleStatus()}
            disabled={busy !== null}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border-2 px-3 py-1.5 text-xs font-black transition-opacity disabled:opacity-60",
              client.status === "active"
                ? "border-destructive/40 text-destructive"
                : "border-success/40 text-success",
            )}
          >
            {client.status === "active" ? (
              <Ban className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )}
            {busy === "toggle" ? "جارٍ التنفيذ…" : client.status === "active" ? "إيقاف" : "تشغيل"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 text-sm font-extrabold sm:grid-cols-2">
        <div>
          <p className="text-xs font-black text-muted-foreground">تاريخ الانضمام</p>
          <p className="text-foreground">{formatDateTime(client.joined_at)}</p>
        </div>
        <div>
          <p className="text-xs font-black text-muted-foreground">تاريخ الانتهاء</p>
          <p className="text-foreground">{formatDateTime(client.expires_at)}</p>
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs font-black text-muted-foreground">
          <span>الوقت المتبقي من الاشتراك</span>
          <span>
            {progress.daysRemaining > 0
              ? `${formatNumber(progress.daysRemaining)} يوم متبقي`
              : "انتهى الاشتراك"}
          </span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all", progressBarTone[progress.tone])}
            style={{ width: `${progress.percentRemaining}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs font-black text-muted-foreground">
        <span>البريد/معرّف المالك:</span>
        <span className="font-mono text-foreground">{client.ownerIdentifier ?? "—"}</span>
        <button
          type="button"
          onClick={() => void toggleCredentials()}
          disabled={loadingCreds}
          className="mr-auto flex items-center gap-1.5 rounded-lg border-2 border-border px-2.5 py-1 text-[11px] font-black text-foreground transition-colors hover:border-primary disabled:opacity-60"
        >
          {credentials ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          {loadingCreds
            ? "جارٍ الجلب…"
            : credentials
              ? "إخفاء بيانات الدخول"
              : "إظهار بيانات الدخول"}
        </button>
      </div>

      {credentials ? (
        <div className="space-y-1.5 rounded-xl border-2 border-dashed border-primary bg-primary/5 p-3">
          <button
            type="button"
            onClick={() => copy(credentials.identifier)}
            className="flex w-full items-center justify-between rounded-lg bg-background px-3 py-2 text-sm font-extrabold hover:bg-muted"
          >
            <span className="text-muted-foreground">الكود</span>
            <span className="font-mono text-foreground">{credentials.identifier}</span>
          </button>
          <p className="px-1 text-xs font-bold text-muted-foreground">
            كلمة السر مُشفَّرة ولا تظهر هنا — تظهر مرة واحدة فقط لحظة إنشاء العميل.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-xs font-black text-muted-foreground">
        <span>آخر نشاط:</span>
        <span className="text-foreground">
          {client.lastActivityAt
            ? formatDateTime(client.lastActivityAt)
            : "لا يوجد دخول مسجَّل بعد"}
        </span>
      </div>

      {client.slug ? (
        <button
          type="button"
          onClick={() => copy(loginLink)}
          dir="ltr"
          className="flex w-full items-center justify-between gap-2 rounded-lg border-2 border-border bg-background px-3 py-2 text-left font-mono text-xs font-black text-foreground"
        >
          <span className="truncate">{loginLink}</span>
          <Copy className="size-4 shrink-0" />
        </button>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t-2 border-border pt-3">
        <button
          type="button"
          onClick={() => void extend("month")}
          disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-lg border-2 border-border px-3 py-1.5 text-xs font-black text-foreground disabled:opacity-60"
        >
          <CalendarClock className="size-3.5" />
          {busy === "extend-month" ? "جارٍ…" : "تمديد + شهر"}
        </button>
        <button
          type="button"
          onClick={() => void extend("year")}
          disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-lg border-2 border-border px-3 py-1.5 text-xs font-black text-foreground disabled:opacity-60"
        >
          <CalendarClock className="size-3.5" />
          {busy === "extend-year" ? "جارٍ…" : "تمديد + سنة"}
        </button>
        <button
          type="button"
          onClick={() => void exportClient()}
          disabled={busy !== null}
          className="mr-auto flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-xs font-black text-navy-foreground disabled:opacity-60"
        >
          <Download className="size-3.5" />
          {busy === "export" ? "جارٍ التصدير…" : "تصدير بيانات العميل"}
        </button>
      </div>
    </div>
  );
}

function ClientsPage() {
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">("all");

  async function refresh() {
    if (!getSession()) return;
    try {
      const rows = await fetchClients();
      setClients(rows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ أثناء تحميل بيانات العملاء");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const summary = useMemo(() => {
    const total = clients.length;
    const active = clients.filter((c) => c.status === "active").length;
    const expiringSoon = clients.filter((c) => {
      if (c.status !== "active") return false;
      const days = (new Date(c.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      return days >= 0 && days <= 30;
    }).length;
    return { total, active, expiringSoon };
  }, [clients]);

  const filtered = useMemo(() => {
    const q = query.trim();
    return clients.filter((c) => {
      const matchesQuery = !q || c.name.includes(q);
      const matchesStatus = statusFilter === "all" || c.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [clients, query, statusFilter]);

  return (
    <div dir="rtl" className="min-h-screen bg-canvas">
      <BrandLogo />
      <PlatformHeader
        title="إدارة المنصة — كل العملاء"
        subtitle="متابعة كل عميل واشتراكه من مكان واحد"
        active="clients"
      />

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="إجمالي العملاء"
            value={formatNumber(summary.total)}
            icon={Users}
            tone="primary"
          />
          <StatCard
            label="عملاء نشطون"
            value={formatNumber(summary.active)}
            icon={Sparkles}
            tone="success"
          />
          <StatCard
            label="هينتهي اشتراكهم خلال 30 يوم"
            value={formatNumber(summary.expiringSoon)}
            icon={CalendarClock}
            tone={summary.expiringSoon > 0 ? "warning" : "primary"}
          />
        </div>

        <Panel title="بحث وفلترة" className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ابحث باسم السنتر"
                className="w-full rounded-xl border-2 border-border bg-background py-3 pl-4 pr-10 text-sm font-extrabold text-foreground outline-none placeholder:font-bold placeholder:text-muted-foreground focus:border-primary"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "paused")}
              className="rounded-xl border-2 border-border bg-background px-4 py-3 text-sm font-extrabold text-foreground outline-none focus:border-primary"
            >
              <option value="all">كل الحالات</option>
              <option value="active">نشط فقط</option>
              <option value="paused">متوقف فقط</option>
            </select>
          </div>
        </Panel>

        {loading ? (
          <p className="py-10 text-center text-sm font-bold text-muted-foreground">
            جارٍ تحميل بيانات العملاء…
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm font-bold text-muted-foreground">
            لا يوجد عملاء مطابقون
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {filtered.map((client) => (
              <ClientCard key={client.id} client={client} onChanged={() => void refresh()} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
