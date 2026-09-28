import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, TrendingDown, TrendingUp, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Panel, StatCard, StatusBadge } from "@/components/dashboard/StatCard";
import { AppShell } from "@/components/layout/AppShell";
import { BEHAVIOR_LEVELS } from "@/components/session/SessionSteps";
import { AwardsAndAlertsPanel } from "@/components/teacher/AwardsAndAlertsPanel";
import { GroupMetricsPanel } from "@/components/teacher/GroupMetricsPanel";
import { StudentClassificationCard } from "@/components/teacher/StudentClassificationCard";
import { BarChart } from "@/components/ui/BarChart";
import { useCurrentTeacher } from "@/hooks/use-current-teacher";
import { formatNumber, formatPercent } from "@/lib/format";
import {
  classifyStudent,
  classificationReason,
  getAssessmentScore,
  getGroupsForTeacher,
  getStudentsForGroup,
  useDataStore,
  useIsHydrated,
  type DataState,
} from "@/lib/data-store";
import { cn } from "@/lib/utils";
import type { AttendanceStatus, Group, Student } from "@/types";

export const Route = createFileRoute("/teacher/assessments")({
  validateSearch: (search: Record<string, unknown>): { studentId?: string } =>
    typeof search["studentId"] === "string" ? { studentId: search["studentId"] } : {},
  head: () => ({
    meta: [
      { title: "التقييمات والغياب — المدرس" },
      {
        name: "description",
        content: "تقرير عام للحضور والواجب والأنشطة والسلوك — قراءة فقط.",
      },
      { property: "og:title", content: "التقييمات والغياب — المدرس" },
      { property: "og:description", content: "تقرير شامل قراءة فقط لأداء كل الطلاب." },
    ],
  }),
  component: AssessmentsPage,
});

const ALL = "all" as const;

function AssessmentsPage() {
  const state = useDataStore();
  const isHydrated = useIsHydrated();
  const teacher = useCurrentTeacher();
  const { studentId: alertStudentId } = Route.useSearch();
  useEffect(() => {
    if (isHydrated && !teacher) toast.error("الجلسة منتهية — سجّل الدخول من جديد");
  }, [teacher, isHydrated]);

  // كل الـ hooks لازم تُستدعى بنفس الترتيب في كل render — قبل أي early return
  // (isHydrated/teacher بيتغيّروا بمرور الوقت، فلو الـ hooks كانت بعد الـ return
  // كان عددها هيختلف بين render وتاني وده بيكسر React Hooks rules فعلياً).
  const myGroups = teacher ? getGroupsForTeacher(state, teacher.id) : [];
  const grades = useMemo(
    () =>
      Array.from(
        new Set(
          myGroups
            .map((g) => g.grade)
            .filter((x): x is string => typeof x === "string" && x.trim().length > 0),
        ),
      ),
    [myGroups],
  );

  const [gradeFilter, setGradeFilter] = useState<string | typeof ALL>(ALL);
  const [groupFilter, setGroupFilter] = useState<string | typeof ALL>(ALL);

  const gradeGroups =
    gradeFilter === ALL ? myGroups : myGroups.filter((g) => g.grade === gradeFilter);
  const visibleGroups =
    groupFilter === ALL ? gradeGroups : gradeGroups.filter((g) => g.id === groupFilter);
  const visibleStudents = useMemo(
    () => visibleGroups.flatMap((g) => getStudentsForGroup(state, g.id)),
    [visibleGroups, state.students],
  );

  if (!isHydrated) return null;
  if (!teacher) return <Navigate to="/login" />;

  // المجموعة المختارة فعلياً (عند الفلتر بمجموعة واحدة) — للـ 8 كروت.
  const selectedGroup: Group | null = groupFilter === ALL ? null : (visibleGroups[0] ?? null);

  const scoreOf = (studentId: string, category: "homework" | "activity" | "behavior") =>
    getAssessmentScore(state, studentId, category, teacher.id);

  const excellent = visibleStudents.filter((s) => classifyStudent(s) === "excellent");
  const needsAttention = visibleStudents.filter((s) => classifyStudent(s) === "needs_attention");

  return (
    <AppShell
      role="teacher"
      title="التقييمات والغياب"
      description="تقرير عام قراءة فقط — للتسجيل والتعديل بأثر رجعي افتح الدرس المطلوب من وضع الحصة"
    >
      <Panel title="فلترة التقرير" description="حسب المرحلة والمجموعة">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <FilterPill
              active={gradeFilter === ALL}
              onClick={() => {
                setGradeFilter(ALL);
                setGroupFilter(ALL);
              }}
            >
              كل المراحل
            </FilterPill>
            {grades.map((grade) => (
              <FilterPill
                key={grade}
                active={gradeFilter === grade}
                onClick={() => {
                  setGradeFilter(grade);
                  setGroupFilter(ALL);
                }}
              >
                {grade}
              </FilterPill>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterPill active={groupFilter === ALL} onClick={() => setGroupFilter(ALL)}>
              كل المجموعات
            </FilterPill>
            {gradeGroups.map((g) => (
              <FilterPill
                key={g.id}
                active={groupFilter === g.id}
                onClick={() => setGroupFilter(g.id)}
              >
                {g.name}
              </FilterPill>
            ))}
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="عدد الطلاب"
          value={formatNumber(visibleStudents.length)}
          icon={CheckCircle2}
        />
        <StatCard
          label="الطلاب المتفوقون"
          value={formatNumber(excellent.length)}
          icon={TrendingUp}
          tone="success"
        />
        <StatCard
          label="يحتاجون تحسين"
          value={formatNumber(needsAttention.length)}
          icon={TrendingDown}
          tone="warning"
        />
      </div>

      {selectedGroup ? (
        <>
          <Panel
            title={`بطاقات وصفية — ${selectedGroup.name}`}
            description="8 مؤشرات حقيقية لمجموعة معيّنة"
          >
            <GroupMetricsPanel group={selectedGroup} />
          </Panel>
        </>
      ) : null}

      <Panel
        title="الأوسمة والتنبيهات"
        description="للمتفوقين: وسام تشجيعي · للضعاف: تنبيه لولي الأمر / حديث فردي / ملاحظة"
      >
        <AwardsAndAlertsPanel
          teacherId={teacher.id}
          students={visibleStudents}
          openStudentId={alertStudentId}
        />
      </Panel>

      <Panel
        title="سجل الحضور"
        description="جدول موحّد لكل الطلاب ضمن فلتر المرحلة/المجموعة أعلاه — قراءة فقط"
      >
        <AttendanceGrid state={state} students={visibleStudents} />
      </Panel>

      <Panel title="عرض عام للطلاب" description="نظرة شاملة على كل مؤشرات كل طالب">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-right text-sm">
            <thead>
              <tr className="border-b-2 border-border text-muted-foreground">
                <th className="pb-3">الطالب</th>
                <th className="pb-3">الحضور</th>
                <th className="pb-3">المتوسط</th>
                <th className="pb-3">الواجب</th>
                <th className="pb-3">الأنشطة</th>
                <th className="pb-3">السلوك</th>
                <th className="pb-3">المستوى</th>
              </tr>
            </thead>
            <tbody>
              {visibleStudents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center font-black text-muted-foreground">
                    لا يوجد طلاب ضمن هذا الفلتر
                  </td>
                </tr>
              ) : (
                visibleStudents.map((s) => {
                  const classification = classifyStudent(s);
                  const homework = scoreOf(s.id, "homework");
                  const activity = scoreOf(s.id, "activity");
                  const behavior = scoreOf(s.id, "behavior");
                  return (
                    <tr key={s.id} className="border-b border-border last:border-0">
                      <td className="py-3 font-black text-foreground">{s.full_name}</td>
                      <td className="min-w-[120px] py-3">
                        <BarChart value={s.attendance_rate} />
                      </td>
                      <td className="min-w-[120px] py-3">
                        <BarChart value={s.avg_score} />
                      </td>
                      <td className="py-3 font-bold text-muted-foreground">
                        {homework
                          ? `${formatNumber(homework.value)}/${formatNumber(homework.max_value)}`
                          : "—"}
                      </td>
                      <td className="py-3 font-bold text-muted-foreground">
                        {activity
                          ? `${formatNumber(activity.value)}/${formatNumber(activity.max_value)}`
                          : "—"}
                      </td>
                      <td className="py-3 font-bold text-muted-foreground">
                        {behavior
                          ? (BEHAVIOR_LEVELS.find((l) => l.value === behavior.value)?.label ?? "—")
                          : "—"}
                      </td>
                      <td className="py-3">
                        <StatusBadge
                          tone={
                            classification === "excellent"
                              ? "success"
                              : classification === "needs_attention"
                                ? "destructive"
                                : "warning"
                          }
                        >
                          {classification === "excellent"
                            ? "ممتاز"
                            : classification === "needs_attention"
                              ? "يحتاج متابعة"
                              : "متوسط"}
                        </StatusBadge>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="أعلى الطلاب أداءً" description="الأعلى متوسطاً والتزاماً بالحضور">
          <div className="grid gap-3">
            {excellent.map((s) => (
              <StudentClassificationCard key={s.id} student={s} classification="excellent" />
            ))}
            {excellent.length === 0 ? (
              <p className="py-6 text-center font-black text-muted-foreground">
                لا يوجد طلاب في هذا التصنيف حالياً
              </p>
            ) : null}
          </div>
        </Panel>

        <Panel title="يحتاجون تحسين" description="حسب التصنيف الثلاثي مع سبب مولَّد">
          <div className="grid gap-3">
            {needsAttention.map((s) => (
              <StudentClassificationCard
                key={s.id}
                student={s}
                classification="needs_attention"
                reason={classificationReason(s)}
              />
            ))}
            {needsAttention.length === 0 ? (
              <p className="py-6 text-center font-black text-muted-foreground">
                لا يوجد طلاب في هذا التصنيف حالياً
              </p>
            ) : null}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border-2 px-3 py-2 text-xs font-black transition-colors",
        active
          ? "border-navy bg-navy text-navy-foreground"
          : "border-border bg-background text-foreground hover:border-primary",
      )}
    >
      {children}
    </button>
  );
}

const attendanceIcon: Record<AttendanceStatus, typeof CheckCircle2> = {
  present: CheckCircle2,
  late: Clock,
  absent: XCircle,
};

const ATTENDANCE_TEXT: Record<AttendanceStatus, string> = {
  present: "حاضر",
  late: "متأخر",
  absent: "غائب",
};

const ATTENDANCE_TONE: Record<AttendanceStatus, "success" | "warning" | "destructive"> = {
  present: "success",
  late: "warning",
  absent: "destructive",
};

/**
 * §13-هـ / §20-21: جدول واحد موحَّد لكل الطلاب (بدل جدول منفصل لكل مجموعة) —
 * صف واحد لكل طالب يلخّص حاضر/متأخر/غائب من `attendanceRecords` الحقيقية،
 * ومفلتر تلقائياً بنفس فلتر المرحلة/المجموعة أعلى الصفحة (فلا داعي لفلتر ثانٍ هنا).
 * قراءة فقط — التصحيح بأثر رجعي من داخل وضع الحصة نفسه.
 */
function AttendanceGrid({ state, students }: { state: DataState; students: Student[] }) {
  if (students.length === 0) {
    return (
      <p className="py-8 text-center font-black text-muted-foreground">
        لا يوجد طلاب ضمن هذا الفلتر
      </p>
    );
  }

  const rows = students.map((st) => {
    const records = state.attendanceRecords
      .filter((r) => r.student_id === st.id)
      .sort((a, b) => (a.checked_in_at < b.checked_in_at ? 1 : -1));
    const present = records.filter((r) => r.status === "present").length;
    const late = records.filter((r) => r.status === "late").length;
    const absent = records.filter((r) => r.status === "absent").length;
    const last = records[0] ?? null;
    return { student: st, records, present, late, absent, last };
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-right text-sm">
        <thead>
          <tr className="border-b-2 border-border text-muted-foreground">
            <th className="pb-2">الطالب</th>
            <th className="pb-2">الصف</th>
            <th className="pb-2">المجموعة</th>
            <th className="pb-2 text-center">نسبة الحضور</th>
            <th className="pb-2 text-center">حاضر</th>
            <th className="pb-2 text-center">متأخر</th>
            <th className="pb-2 text-center">غائب</th>
            <th className="pb-2 text-center">آخر حصة</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ student: st, present, late, absent, last }) => (
            <tr key={st.id} className="border-b border-border last:border-0">
              <td className="py-2 font-black text-foreground">{st.full_name}</td>
              <td className="py-2 font-bold text-muted-foreground">{st.grade}</td>
              <td className="py-2 font-bold text-muted-foreground">{last?.group_name ?? "—"}</td>
              <td className="min-w-[120px] py-2">
                <BarChart value={st.attendance_rate} />
              </td>
              <td className="py-2 text-center font-black text-success">{formatNumber(present)}</td>
              <td className="py-2 text-center font-black text-warning">{formatNumber(late)}</td>
              <td className="py-2 text-center font-black text-destructive">
                {formatNumber(absent)}
              </td>
              <td className="py-2 text-center">
                {last ? (
                  (() => {
                    const Icon = attendanceIcon[last.status];
                    return (
                      <span
                        title={`${last.checked_in_at} — ${ATTENDANCE_TEXT[last.status]}`}
                        className={cn(
                          "mx-auto flex w-fit items-center gap-1 rounded-lg border-2 px-2 py-1 text-xs font-black",
                          ATTENDANCE_TONE[last.status] === "success"
                            ? "border-success bg-success/10 text-success"
                            : ATTENDANCE_TONE[last.status] === "warning"
                              ? "border-warning bg-warning/10 text-warning"
                              : "border-destructive bg-destructive/10 text-destructive",
                        )}
                      >
                        <Icon className="size-3.5" /> {ATTENDANCE_TEXT[last.status]}
                      </span>
                    );
                  })()
                ) : (
                  <span className="text-xs font-bold text-muted-foreground">لم يُسجَّل بعد</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
