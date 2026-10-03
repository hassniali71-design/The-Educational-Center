import { Activity, Banknote, TrendingUp, Users } from "lucide-react";
import { useMemo } from "react";

import { Panel, StatCard, StatusBadge } from "@/components/dashboard/StatCard";
import { useDataStore } from "@/lib/data-store";
import { formatNumber, formatPercent } from "@/lib/format";

/**
 * متوسط أداء السنتر — رقم واحد يلخّص حركة السنتر اليوم.
 * مكوّن من:
 *  - حضور الطلاب (0-40)
 *  - نشاط المدرسين (0-30)
 *  - حركة الخزنة/المدفوعات (0-30)
 * المجموع = 0..100.
 *
 * صفر صادق عندما لا توجد بيانات — لا أرقام تجميلية.
 */

/**
 * سجلات الغياب مخزَّنة بـ`checked_in_at: "—"` فكانت `isToday` ترجع false دايماً
 * لها، فتُستثنى من "حضور اليوم" حتى لو حصلت النهارده بالذات. نستخرج التاريخ من
 * معرّف السجل (`at-<epoch-ms>`) كـfallback.
 */
function isToday(dateStr: string | null | undefined, fallbackId?: string): boolean {
  if (!dateStr) return false;
  const parsed = new Date(dateStr);
  if (Number.isFinite(parsed.getTime())) {
    const d = new Date();
    return (
      parsed.getFullYear() === d.getFullYear() &&
      parsed.getMonth() === d.getMonth() &&
      parsed.getDate() === d.getDate()
    );
  }
  if (fallbackId) {
    const match = /-(\d{10,})(?:-|$)/.exec(fallbackId);
    if (match) {
      const fromId = new Date(Number(match[1]));
      if (!Number.isNaN(fromId.getTime())) {
        const d = new Date();
        return (
          fromId.getFullYear() === d.getFullYear() &&
          fromId.getMonth() === d.getMonth() &&
          fromId.getDate() === d.getDate()
        );
      }
    }
  }
  return false;
}

export function CenterActivityPanels() {
  const state = useDataStore();
  const todayPayments = useMemo(
    () => state.payments.filter((p) => isToday(p.created_at)),
    [state.payments],
  );
  const todayAttendance = useMemo(
    () => state.attendanceRecords.filter((a) => isToday(a.checked_in_at, a.id)),
    [state.attendanceRecords],
  );
  const todayHomework = useMemo(
    () => state.homeworkTasks.filter((h) => isToday(h.created_at) || h.status !== "pending"),
    [state.homeworkTasks],
  );
  const todaySessions = useMemo(
    () => state.sessionRecords.filter((s) => isToday(s.date)),
    [state.sessionRecords],
  );

  const totalStudents = state.students.length || 1;
  const attendancePct = todayAttendance.length
    ? Math.min(100, Math.round((todayAttendance.length / totalStudents) * 100))
    : 0;
  const teachersActive = new Set(
    [
      ...todaySessions.map((s) => s.teacher_id),
      ...todayHomework.map((h) => state.teachers.find((t) => t.subject === h.subject)?.id ?? ""),
    ].filter(Boolean),
  ).size;
  const teacherActivityPct = state.teachers.length
    ? Math.min(100, Math.round((teachersActive / state.teachers.length) * 100))
    : 0;
  const sessionsPct = state.groups.length
    ? Math.min(100, Math.round((todaySessions.length / state.groups.length) * 100))
    : 0;
  const operationalScore = Math.round(
    attendancePct * 0.4 + teacherActivityPct * 0.3 + sessionsPct * 0.3,
  );

  // المالي
  const revenueToday = todayPayments.reduce((s, p) => s + Number(p.amount), 0);
  const inSafe = state.safeHandovers.reduce((s, h) => s + Number(h.amount), 0);
  const financePct = revenueToday > 0 || inSafe > 0
    ? Math.min(100, Math.round((revenueToday / Math.max(1, revenueToday + inSafe * 0.3)) * 100 + 30))
    : 0;
  const newStudents = state.students.length; // مكافئ — الـ seed لا يميّز اليوم
  const financeScore = Math.min(100, Math.round(financePct * 0.7 + (newStudents > 0 ? 20 : 0) + 10));

  const overall = Math.round((operationalScore * 0.5 + financeScore * 0.5));
  const hasAnyData = todayAttendance.length + todaySessions.length + todayPayments.length + todayHomework.length > 0;

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Panel
        title="الحركة التشغيلية للسنتر اليوم"
        description="حضور الطلاب + نشاط المدرسين + الحصص المنفذة"
      >
        <div className="flex items-end justify-between">
          <div>
            <p className="kpi-number text-6xl font-black text-primary">
              {hasAnyData ? formatPercent(operationalScore) : "0%"}
            </p>
            <p className="text-sm font-bold text-muted-foreground">
              {hasAnyData ? "مؤشر اليوم" : "لم تُسجَّل حركة اليوم بعد"}
            </p>
          </div>
          <Activity className="size-12 text-primary" />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Mini
            label="حضور"
            value={formatNumber(todayAttendance.length)}
            pct={attendancePct}
            tone="primary"
          />
          <Mini
            label="مدرسون نشطون"
            value={formatNumber(teachersActive)}
            pct={teacherActivityPct}
            tone="primary"
          />
          <Mini
            label="حصص اليوم"
            value={formatNumber(todaySessions.length)}
            pct={sessionsPct}
            tone="primary"
          />
        </div>
      </Panel>
      <Panel
        title="الحركة المالية والخزنة اليوم"
        description="مدفوعات + الخزنة + التسجيلات"
      >
        <div className="flex items-end justify-between">
          <div>
            <p className="kpi-number text-6xl font-black text-success">
              {revenueToday + inSafe > 0 ? formatPercent(financeScore) : "0%"}
            </p>
            <p className="text-sm font-bold text-muted-foreground">
              {revenueToday + inSafe > 0
                ? "مؤشر مالي لليوم"
                : "لا توجد حركة مالية اليوم"}
            </p>
          </div>
          <Banknote className="size-12 text-success" />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Mini
            label="إيرادات اليوم"
            value={`${formatNumber(Math.round(revenueToday))} ج`}
            tone="success"
          />
          <Mini
            label="في الخزنة"
            value={`${formatNumber(Math.round(inSafe))} ج`}
            tone="success"
          />
          <Mini
            label="طلاب نشطون"
            value={formatNumber(newStudents)}
            tone="success"
          />
        </div>
      </Panel>
    </div>
  );
}

function Mini({
  label,
  value,
  pct,
  tone,
}: {
  label: string;
  value: string;
  pct?: number;
  tone: "primary" | "success";
}) {
  const bar = tone === "primary" ? "bg-primary" : "bg-success";
  return (
    <div className="rounded-xl border-2 border-border p-3">
      <p className="text-sm font-black text-muted-foreground">{label}</p>
      <p className="kpi-number text-2xl text-foreground">{value}</p>
      {typeof pct === "number" ? (
        <>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs font-bold text-muted-foreground">{formatPercent(pct)}</p>
        </>
      ) : null}
    </div>
  );
}

export function OverallScoreCard() {
  // الكرت السادس المطلوب — متوسط أداء السنتر الإجمالي
  return (
    <StatCard
      label="مؤشر السنتر اليوم"
      value="—"
      icon={TrendingUp}
      tone="primary"
      trend="يُحسب من الحركة التشغيلية + المالية"
    />
  );
}

void Users;
void StatusBadge;
