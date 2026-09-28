import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { useMemo } from "react";

import { Panel } from "@/components/dashboard/StatCard";
import { getStudentsForGroup, useDataStore } from "@/lib/data-store";
import { cn } from "@/lib/utils";
import type { AttendanceStatus } from "@/types";

/**
 * بوكس حضور قراءة فقط بالكامل — الموظف وحده يسجّل الحضور (`markAttendanceForGroup`
 * من بوابة الحضور)، والمدرس هنا يطّلع فقط على ما سجّله الموظف. لا يوجد أي زر أو
 * دالة تسجيل/تعديل هنا عمداً — نقل مسؤولية الحضور بالكامل للموظف/السكرتارية.
 */
export function AttendanceRosterBox({ groupId }: { groupId: string }) {
  const state = useDataStore();
  const students = useMemo(
    () => getStudentsForGroup(state, groupId),
    [state.students, groupId],
  );

  const recordsByStudent = useMemo(() => {
    const map = new Map<string, { status: AttendanceStatus; late_minutes: number }>();
    for (const r of state.attendanceRecords) {
      // group_id غير موجود على attendanceRecords، فلتر بالـ student.group_id
      const student = students.find((s) => s.id === r.student_id);
      if (student && student.group_id === groupId) {
        map.set(r.student_id, { status: r.status, late_minutes: r.late_minutes ?? 0 });
      }
    }
    return map;
  }, [state.attendanceRecords, students, groupId]);

  const counts = useMemo(() => {
    let present = 0;
    let late = 0;
    let absent = 0;
    let unmarked = 0;
    for (const s of students) {
      const rec = recordsByStudent.get(s.id);
      if (!rec) unmarked += 1;
      else if (rec.status === "present") present += 1;
      else if (rec.status === "late") late += 1;
      else if (rec.status === "absent") absent += 1;
    }
    return { present, late, absent, unmarked };
  }, [students, recordsByStudent]);

  return (
    <Panel
      title="سجل الحضور والغياب"
      description="الموظف يسجّل — أنت تطّلع فقط (قراءة فقط). يحدّث تلقائياً كل تسجيل جديد."
    >
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryChip label="حاضر" value={counts.present} tone="success" Icon={CheckCircle2} />
        <SummaryChip label="متأخر" value={counts.late} tone="warning" Icon={Clock} />
        <SummaryChip label="غائب" value={counts.absent} tone="destructive" Icon={XCircle} />
        <SummaryChip label="لم يُسجَّل" value={counts.unmarked} tone="neutral" Icon={Clock} />
      </div>

      <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
        {students.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-border p-6 text-center text-sm font-bold text-muted-foreground">
            لا يوجد طلاب في هذه المجموعة بعد.
          </p>
        ) : (
          students.map((s) => {
            const rec = recordsByStudent.get(s.id);
            const status = rec?.status ?? null;
            return (
              <div
                key={s.id}
                className={cn(
                  "flex items-center justify-between rounded-xl border-2 px-3 py-2",
                  status === "present"
                    ? "border-success/30 bg-success/5"
                    : status === "late"
                      ? "border-warning/40 bg-warning/5"
                      : status === "absent"
                        ? "border-destructive/30 bg-destructive/5"
                        : "border-border bg-background",
                )}
              >
                <p className="min-w-0 flex-1 truncate text-sm font-black text-foreground">
                  {s.full_name}
                </p>
                <div className="flex items-center gap-1.5">
                  <StatusChip status={status} lateMinutes={rec?.late_minutes ?? 0} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}

const TONE_BG: Record<AttendanceStatus | "unmarked", string> = {
  present: "bg-success/12 text-success border-success/30",
  late: "bg-warning/15 text-warning border-warning/40",
  absent: "bg-destructive/10 text-destructive border-destructive/30",
  unmarked: "bg-muted text-muted-foreground border-border",
};

function StatusChip({
  status,
  lateMinutes,
}: {
  status: AttendanceStatus | null;
  lateMinutes: number;
}) {
  const key = status ?? "unmarked";
  const label =
    status === "present"
      ? "حاضر"
      : status === "late"
        ? `متأخر ${lateMinutes}د`
        : status === "absent"
          ? "غائب"
          : "لم يُسجَّل";
  return (
    <span className={cn("rounded-lg border-2 px-2 py-0.5 text-[11px] font-black", TONE_BG[key])}>
      {label}
    </span>
  );
}

function SummaryChip({
  label,
  value,
  tone,
  Icon,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "destructive" | "neutral";
  Icon: typeof CheckCircle2;
}) {
  const ring = {
    success: "bg-success/10 text-success",
    warning: "bg-warning/15 text-warning",
    destructive: "bg-destructive/10 text-destructive",
    neutral: "bg-muted text-muted-foreground",
  }[tone];
  return (
    <div className="flex items-center gap-2 rounded-xl border-2 border-border bg-background p-2.5">
      <span className={cn("flex size-8 items-center justify-center rounded-lg", ring)}>
        <Icon className="size-4" />
      </span>
      <div>
        <p className="kpi-number text-xl text-foreground">{value}</p>
        <p className="text-[11px] font-black text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
