import { CheckCircle2, Clock, PlayCircle, UserCheck, UserX, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Panel, StatusBadge } from "@/components/dashboard/StatCard";
import { AppShell } from "@/components/layout/AppShell";
import { DailyStaffEvents } from "@/components/staff/DailyStaffEvents";
import { getStudentsForGroup, markAttendanceForGroup, useDataStore } from "@/lib/data-store";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { buildActiveGroupsNow } from "@/lib/owner-metrics";
import { cn } from "@/lib/utils";
import type { Group, Student } from "@/types";

/**
 * بوابة الحضور للموظف — إعادة بناء كاملة:
 *  - 4 كروت حوكمة (نسبة حضور / حالات تأخير / مجموعات مكتملة / متوسط دقائق التأخير).
 *  - "المجموعات النشطة الآن" (استخدام `buildActiveGroupsNow` من owner-metrics).
 *  - Modal لكل مجموعة فيه قائمة طلاب + زرارين حضور/غياب مع نافذة 10/50 دقيقة.
 *  - بطاقتا سجل (حضور كامل + غياب كامل) بفلتر شهر/يوم/بحث.
 *  - آخر 5 عمليات تسجيل.
 */

const STATUS_TONE = {
  present: "success",
  late: "warning",
  absent: "destructive",
} as const;

function sameDay(iso: string, ref: Date): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.startsWith("اليوم") || iso === "—";
  const d = new Date(t);
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

function statusLabel(s: "present" | "late" | "absent") {
  return s === "present" ? "حاضر" : s === "late" ? "متأخر" : "غائب";
}

export function StaffGate() {
  const state = useDataStore();
  const { students, attendanceRecords } = state;
  const now = new Date();
  const today = now.toDateString();
  const todayRecords = attendanceRecords.filter((r) => sameDay(r.checked_in_at, now));

  const present = todayRecords.filter((r) => r.status === "present").length;
  const late = todayRecords.filter((r) => r.status === "late").length;
  const absent = todayRecords.filter((r) => r.status === "absent").length;
  const total = present + late + absent;
  const rate = total > 0 ? Math.round(((present + late) / total) * 100) : 0;
  const lateMinutesAvg = (() => {
    const lates = todayRecords.filter((r) => r.status === "late");
    if (lates.length === 0) return 0;
    return Math.round(lates.reduce((s, r) => s + (r.late_minutes ?? 0), 0) / lates.length);
  })();

  const active = useMemo(() => buildActiveGroupsNow(state, now), [state, today]);
  // مشتق من `active` (نفس مصدر scheduleSlots الصحيح)، مش من `groups.filter(g =>
  // g.weekday === today)` القديمة — تلك كانت بترجع فقط أول يوم مجدول لكل مجموعة
  // فبتفوّت أي مجموعة معادها التاني اليوم، فيظهر "مجموعات مكتملة التسجيل" أقل
  // من الحقيقة.
  const todayGroupNames = new Set(active.map((row) => row.group.name));
  const completedGroups = new Set(todayRecords.map((r) => r.group_name));
  const completedTodayGroups = [...todayGroupNames].filter((n) => completedGroups.has(n)).length;

  const [openGroup, setOpenGroup] = useState<Group | null>(null);

  return (
    <AppShell
      role="staff"
      title="بوابة الحضور"
      description="سجّل حضور المجموعات النشطة بضغطة واحدة واحترم نافذة الـ 50 دقيقة"
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="نسبة الحضور اليوم"
          value={formatPercent(rate)}
          icon={CheckCircle2}
          tone="success"
        />
        <Stat label="حالات تأخير اليوم" value={formatNumber(late)} icon={Clock} tone="warning" />
        <Stat
          label="مجموعات مكتملة التسجيل"
          value={`${formatNumber(completedTodayGroups)} / ${formatNumber(todayGroupNames.size)}`}
          icon={Users}
          tone="primary"
        />
        <Stat
          label="متوسط دقائق التأخير"
          value={lateMinutesAvg ? `${formatNumber(lateMinutesAvg)} د` : "—"}
          icon={Clock}
          tone="warning"
        />
      </div>

      <Panel
        title="المجموعات النشطة الآن"
        description="اضغط على المجموعة لفتح قائمة الطلاب وتسجيل الحضور"
      >
        {active.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-border p-6 text-center text-sm font-black text-muted-foreground">
            لا توجد مجموعات نشطة الآن ({weekdayAr(now)}).
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {active.map((row) => {
              const status = row.started
                ? row.activated
                  ? "success"
                  : row.lateMinutes > 15
                    ? "destructive"
                    : "warning"
                : "neutral";
              const label = row.started
                ? row.activated
                  ? "بدأت"
                  : `متأخرة ${formatNumber(row.lateMinutes)} د`
                : `قادمة بعد ${formatNumber(-row.lateMinutes)} د`;
              return (
                <button
                  key={row.slotId}
                  onClick={() => setOpenGroup(row.group)}
                  className={cn(
                    "rounded-2xl border-2 p-4 text-right transition-opacity hover:opacity-90",
                    status === "success"
                      ? "border-success/40 bg-success/5"
                      : status === "destructive"
                        ? "border-destructive/40 bg-destructive/5"
                        : status === "warning"
                          ? "border-warning/40 bg-warning/5"
                          : "border-border bg-background",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-base font-black text-foreground">{row.group.name}</p>
                      <p className="text-xs font-bold text-muted-foreground">
                        {row.group.teacher_name} · {row.group.subject} · قاعة {row.room}
                      </p>
                      <p className="mt-1 text-xs font-bold text-muted-foreground">
                        الموعد {row.time} · {formatNumber(row.enrolled)} /{" "}
                        {formatNumber(row.group.capacity)} طالب
                      </p>
                    </div>
                    <PlayCircle className="size-6 shrink-0 text-primary" />
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <StatusBadge tone={status}>{label}</StatusBadge>
                    <span className="text-xs font-black text-muted-foreground">
                      {completedGroups.has(row.group.name) ? "تم التسجيل ✓" : "في انتظار التسجيل"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <FullLogPanel
          title="سجل الحضور الكامل"
          emptyText="لا توجد عمليات حضور بعد."
          filterFn={(r) => r.status !== "absent"}
          countFn={(rec) => (rec.status === "absent" ? 0 : 1)}
          topCount={(map) =>
            [...map.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([sid, c]) => ({
                label: students.find((s) => s.id === sid)?.full_name ?? sid,
                value: formatNumber(c),
              }))
          }
          label="حضور"
        />
        <FullLogPanel
          title="سجل الغياب الكامل"
          emptyText="لا توجد عمليات غياب بعد."
          filterFn={(r) => r.status === "absent"}
          countFn={(rec) => (rec.status === "absent" ? 1 : 0)}
          topCount={(map) =>
            [...map.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([sid, c]) => ({
                label: students.find((s) => s.id === sid)?.full_name ?? sid,
                value: formatNumber(c),
              }))
          }
          label="غياب"
        />
      </div>

      <Panel title="آخر 5 عمليات تسجيل حضور" description="أحدث ما تم تسجيله في البوابة">
        <div className="space-y-2">
          {todayRecords.slice(0, 5).map((rec) => (
            <div
              key={rec.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-border p-3"
            >
              <div className="min-w-0">
                <p className="truncate font-black text-foreground">{rec.student_name}</p>
                <p className="truncate text-xs font-bold text-muted-foreground">
                  {rec.group_name} · {formatDateTime(rec.checked_in_at)}
                </p>
              </div>
              <StatusBadge tone={STATUS_TONE[rec.status]}>{statusLabel(rec.status)}</StatusBadge>
            </div>
          ))}
          {todayRecords.length === 0 ? (
            <p className="rounded-xl border-2 border-dashed border-border p-4 text-center text-sm font-bold text-muted-foreground">
              لا توجد عمليات بعد.
            </p>
          ) : null}
        </div>
      </Panel>

      {/*
        DailyStaffEvents كان مكوّناً كاملاً وحقيقياً (مدفوعات/مبيعات ملازم/
        تأخير-غياب/مهام اليوم) لكن غير مربوط بأي صفحة إطلاقاً — الموظف كان
        شايف بوابة الحضور بس بدون أي نظرة عامة على نشاط السنتر اليوم.
      */}
      <DailyStaffEvents />

      {openGroup ? (
        <GroupAttendanceModal group={openGroup} onClose={() => setOpenGroup(null)} />
      ) : null}
    </AppShell>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof CheckCircle2;
  tone: "primary" | "success" | "warning" | "destructive";
}) {
  return (
    <div className="card-crisp p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-extrabold text-muted-foreground">{label}</p>
        <span
          className={cn(
            "flex size-10 items-center justify-center rounded-xl",
            tone === "primary" && "bg-primary/10 text-primary",
            tone === "success" && "bg-success/10 text-success",
            tone === "warning" && "bg-warning/15 text-warning",
            tone === "destructive" && "bg-destructive/10 text-destructive",
          )}
        >
          <Icon className="size-5" />
        </span>
      </div>
      <p className="kpi-number mt-4 text-3xl md:text-4xl">{value}</p>
    </div>
  );
}

function weekdayAr(d: Date): string {
  return ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"][d.getDay()]!;
}

interface FullLogPanelProps {
  title: string;
  emptyText: string;
  filterFn: (r: { status: "present" | "late" | "absent" }) => boolean;
  countFn: (r: { status: "present" | "late" | "absent" }) => number;
  topCount: (map: Map<string, number>) => { label: string; value: string }[];
  label: string;
}

function FullLogPanel({ title, emptyText, filterFn, countFn, topCount }: FullLogPanelProps) {
  const { attendanceRecords, students } = useDataStore();
  const months = useMemo(() => {
    const set = new Set<string>();
    attendanceRecords.forEach((r) => {
      const t = Date.parse(r.checked_in_at);
      if (!Number.isNaN(t)) {
        const d = new Date(t);
        set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
    });
    return Array.from(set).sort().reverse();
  }, [attendanceRecords]);

  const [month, setMonth] = useState<string>("");
  const [day, setDay] = useState<string>("");
  const [q, setQ] = useState("");

  const days = useMemo(() => {
    if (!month) return [] as string[];
    const set = new Set<string>();
    attendanceRecords.forEach((r) => {
      const t = Date.parse(r.checked_in_at);
      if (Number.isNaN(t)) return;
      const d = new Date(t);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (key === month) set.add(String(d.getDate()));
    });
    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }, [attendanceRecords, month]);

  const records = attendanceRecords
    .filter(filterFn)
    .filter((r) => {
      const t = Date.parse(r.checked_in_at);
      if (Number.isNaN(t)) return true;
      const d = new Date(t);
      if (month) {
        const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (m !== month) return false;
      }
      if (day && String(d.getDate()) !== day) return false;
      return true;
    })
    .filter((r) => {
      if (!q.trim()) return true;
      return r.student_name.toLowerCase().includes(q.trim().toLowerCase());
    })
    .sort((a, b) => (a.checked_in_at < b.checked_in_at ? 1 : -1));

  const counts = new Map<string, number>();
  records.forEach((r) => {
    const c = countFn(r);
    counts.set(r.student_id, (counts.get(r.student_id) ?? 0) + c);
  });
  const top = topCount(counts);

  return (
    <Panel title={title} description="ابحث بالاسم وافلت بالشهر واليوم">
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="بحث بالاسم"
          className="h-10 min-w-[160px] flex-1 rounded-xl border-2 border-border bg-background px-3 text-sm font-black outline-none focus:border-primary"
        />
        <select
          value={month}
          onChange={(e) => {
            setMonth(e.target.value);
            setDay("");
          }}
          className="h-10 rounded-xl border-2 border-border bg-background px-2 text-sm font-black"
        >
          <option value="">كل الشهور</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="h-10 rounded-xl border-2 border-border bg-background px-2 text-sm font-black"
          disabled={!month}
        >
          <option value="">كل الأيام</option>
          {days.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      {top.length > 0 ? (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {top.map((t, i) => (
            <div key={i} className="rounded-lg border-2 border-border p-2 text-center">
              <p className="kpi-number text-base">{t.value}</p>
              <p className="truncate text-[11px] font-extrabold text-muted-foreground">{t.label}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="max-h-[480px] space-y-2 overflow-y-auto">
        {records.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-border p-6 text-center text-sm font-black text-muted-foreground">
            {emptyText}
          </p>
        ) : (
          records.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-border p-3"
            >
              <div className="min-w-0">
                <p className="truncate font-black text-foreground">
                  {students.find((s) => s.id === r.student_id)?.full_name ?? r.student_name}
                </p>
                <p className="truncate text-xs font-bold text-muted-foreground">
                  {r.group_name} · {formatDateTime(r.checked_in_at)}
                </p>
              </div>
              <StatusBadge tone={STATUS_TONE[r.status]}>{statusLabel(r.status)}</StatusBadge>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

function GroupAttendanceModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const state = useDataStore();
  const { attendanceRecords } = state;
  const groupStudents = getStudentsForGroup(state, group.id);
  const today = new Date();
  const todayMap = new Map<string, "present" | "late" | "absent">();
  attendanceRecords.forEach((r) => {
    if (r.group_name === group.name && sameDay(r.checked_in_at, today)) {
      todayMap.set(r.student_id, r.status);
    }
  });

  const startMs = (() => {
    const m = /(\d{1,2})[:.](\d{2})/.exec(group.time);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2]);
    if (/م|pm/i.test(group.time) && h < 12) h += 12;
    if (/ص|am/i.test(group.time) && h === 12) h = 0;
    const d = new Date(today);
    d.setHours(h, min, 0, 0);
    return d.getTime();
  })();
  const elapsedMin = startMs ? (today.getTime() - startMs) / 60000 : 0;
  const windowClosed = elapsedMin > 50;

  function mark(student: Student, intent: "present" | "absent") {
    const r = markAttendanceForGroup(group.id, student.id, intent);
    if (r === "WINDOW_CLOSED") toast.error("نافذة التسجيل مغلقة — لا يمكن التعديل");
    else if (r === "STUDENT_NOT_FOUND" || r === "GROUP_NOT_FOUND")
      toast.error("تعذّر العثور على الطالب");
    else if (intent === "absent") toast.success(`تم تسجيل غياب ${student.full_name}`);
    else toast.success(`تم تسجيل حضور ${student.full_name}`);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div className="card-crisp w-full max-w-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-lg font-black text-foreground">{group.name}</p>
            <p className="text-xs font-bold text-muted-foreground">
              {group.teacher_name} · {group.subject} · الموعد {group.time}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border-2 border-border p-1.5 hover:border-destructive"
            aria-label="إغلاق"
          >
            <X className="size-4" />
          </button>
        </div>
        {windowClosed ? (
          <div className="mt-3 rounded-xl border-2 border-destructive/40 bg-destructive/5 p-3 text-center text-sm font-black text-destructive">
            نافذة التسجيل مغلقة (انقضى ٥٠ دقيقة)
          </div>
        ) : null}
        <div className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto">
          {groupStudents.length === 0 ? (
            <p className="rounded-xl border-2 border-dashed border-border p-6 text-center text-sm font-black text-muted-foreground">
              لا يوجد طلاب مسجَّلون في هذه المجموعة.
            </p>
          ) : (
            groupStudents.map((s) => {
              const cur = todayMap.get(s.id);
              return (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-black text-foreground">{s.full_name}</p>
                    <p className="truncate text-xs font-bold text-muted-foreground">
                      {s.code} · حضور {formatPercent(s.attendance_rate)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {cur ? (
                      <StatusBadge tone={STATUS_TONE[cur]}>{statusLabel(cur)}</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">لم يُسجَّل</StatusBadge>
                    )}
                    <button
                      onClick={() => mark(s, "present")}
                      disabled={windowClosed}
                      className="flex items-center gap-1 rounded-xl bg-success px-3 py-2 text-xs font-black text-white disabled:opacity-40"
                    >
                      <UserCheck className="size-3.5" /> حضور
                    </button>
                    <button
                      onClick={() => mark(s, "absent")}
                      disabled={windowClosed}
                      className="flex items-center gap-1 rounded-xl bg-destructive px-3 py-2 text-xs font-black text-white disabled:opacity-40"
                    >
                      <UserX className="size-3.5" /> غياب
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
