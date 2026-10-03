import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Award, CalendarCheck, CalendarDays, Heart, Target } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  McqAnswerBody,
  MatchingAnswerBody,
  OrderingAnswerBody,
  QUESTION_KIND_LABELS,
} from "@/components/session/SessionSteps";
import {
  PerformanceChart,
  SubjectGauge,
  StudentCalendarWeekAttendanceChart,
} from "@/components/dashboard/Charts";
import { Panel, StatCard, StatusBadge } from "@/components/dashboard/StatCard";
import { AppShell } from "@/components/layout/AppShell";
import { AvatarUpload } from "@/components/shared/AvatarUpload";
import { formatNumber, formatPercent } from "@/lib/format";
import { useCurrentStudent } from "@/hooks/use-current-student";
import {
  getAverageBehaviorScore,
  getElectronicHomeworkForGroup,
  getElectronicHomeworkScore,
  getGroupsForStudent,
  getOverallStudentPerformance,
  getPerformanceLayers,
  recordAssessmentScore,
  setStudentAvatar,
  useDataStore,
  useIsHydrated,
  type DataState,
} from "@/lib/data-store";
import { buildStudentAttendanceByCalendarWeek, WEEKDAYS } from "@/lib/owner-metrics";
import type { ElectronicHomework } from "@/types";

/**
 * CURRICULUM_ENGINE_SPEC.md §8 — "واجب الويب سايت": same question bank and
 * answer components as the in-session random-question picker, reused here in
 * a second context. Auto-submits once every question is answered (source:
 * "auto"), which also flips `getElectronicHomeworkScore` so the parent swaps
 * this panel for the "تم التسليم" summary on the next render.
 */
function ElectronicHomeworkPanel({
  homework,
  studentId,
  teacherId,
}: {
  homework: ElectronicHomework;
  studentId: string;
  teacherId: string;
}) {
  const [results, setResults] = useState<Record<number, boolean>>({});
  const allAnswered = Object.keys(results).length === homework.questions.length;

  useEffect(() => {
    if (!allAnswered) return;
    const correctCount = Object.values(results).filter(Boolean).length;
    recordAssessmentScore({
      studentId,
      teacherId,
      category: "e_homework",
      source: "auto",
      value: correctCount,
      maxValue: homework.questions.length,
      lessonId: homework.lesson_id,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAnswered]);

  return (
    <div className="space-y-4">
      {homework.questions.map((q, i) => (
        <div key={q.id} className="rounded-xl border-2 border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <StatusBadge tone="primary">{QUESTION_KIND_LABELS[q.kind]}</StatusBadge>
            {results[i] !== undefined ? (
              <StatusBadge tone={results[i] ? "success" : "destructive"}>
                {results[i] ? "إجابة صحيحة" : "إجابة خاطئة"}
              </StatusBadge>
            ) : null}
          </div>
          <p className="mt-3 text-lg font-black text-foreground">{q.text}</p>
          {q.kind === "ordering" ? (
            <OrderingAnswerBody
              question={q}
              answered={results[i] !== undefined}
              onAnswer={(correct) => setResults((prev) => ({ ...prev, [i]: correct }))}
            />
          ) : q.kind === "matching" ? (
            <MatchingAnswerBody
              question={q}
              answered={results[i] !== undefined}
              onAnswer={(correct) => setResults((prev) => ({ ...prev, [i]: correct }))}
            />
          ) : (
            <McqAnswerBody
              question={q}
              answered={results[i] !== undefined}
              onAnswer={(correct) => setResults((prev) => ({ ...prev, [i]: correct }))}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ElectronicHomeworkSection({ state, studentId }: { state: DataState; studentId: string }) {
  const student = state.students.find((s) => s.id === studentId);
  const homework = student?.group_id
    ? getElectronicHomeworkForGroup(state, student.group_id)
    : undefined;
  if (!homework) return null;

  const lesson = state.lessons.find((l) => l.id === homework.lesson_id);
  const score = getElectronicHomeworkScore(state, studentId, homework.lesson_id);

  return (
    <Panel title="الواجب الإلكتروني" description={`آخر موعد للتسليم: ${homework.due_at}`}>
      {score ? (
        <div className="rounded-xl border-2 border-success bg-success/10 p-4 text-center">
          <p className="font-black text-success">
            تم التسليم — الدرجة: {formatPercent(Math.round((score.value / score.max_value) * 100))}
          </p>
        </div>
      ) : lesson ? (
        <ElectronicHomeworkPanel
          homework={homework}
          studentId={studentId}
          teacherId={lesson.created_by_teacher_id}
        />
      ) : null}
    </Panel>
  );
}

export const Route = createFileRoute("/student/")({
  head: () => ({
    meta: [
      { title: "لوحة الطالب — أدائي ونقاطي" },
      {
        name: "description",
        content: "متابعة الحضور والدرجات اللحظية والواجبات والنقاط داخل السنتر التعليمي.",
      },
      { property: "og:title", content: "لوحة الطالب — أدائي ونقاطي" },
      {
        property: "og:description",
        content: "حضورك ودرجاتك وواجباتك ونقاط التحفيز في مكان واحد.",
      },
    ],
  }),
  component: StudentPortal,
});

function StudentPortal() {
  const state = useDataStore();
  const isHydrated = useIsHydrated();
  const me = useCurrentStudent();
  useEffect(() => {
    if (isHydrated && !me) toast.error("الجلسة منتهية — سجّل الدخول من جديد");
  }, [me, isHydrated]);

  const myGroups = getGroupsForStudent(state, me?.id ?? "");
  const overallPerformance = getOverallStudentPerformance(state, me?.id ?? "");

  if (!isHydrated) return null;
  if (!me) return <Navigate to="/login" />;

  const myAttendanceRecords = state.attendanceRecords.filter((a) => a.student_id === me.id);
  const attendanceRate =
    myAttendanceRecords.length > 0
      ? Math.round(
          (myAttendanceRecords.filter((r) => r.status !== "absent").length /
            myAttendanceRecords.length) *
            100,
        )
      : me.attendance_rate;

  const behaviorScore = getAverageBehaviorScore(state, me.id);

  // ملخّص نتائجي: أعمدة مُجمَّعة (واجبات/مهام/أنشطة/سلوك) عبر كل المواد المشترك
  // فيها الطالب — مش منحنى زمني لكل تسليم على حدة، ده تجميع حقيقي واضح للعين.
  const performanceLayers = getPerformanceLayers(state, me.id).map((layer) => ({
    subject: layer.label,
    avg: layer.pct,
  }));

  const today = WEEKDAYS[new Date().getDay()];

  /**
   * مصدر مواعيد الطالب: `state.scheduleSlots`، مش `group.weekday`/`group.time`
   * القديمة — مجموعة متجدولة بأكتر من يوم (مثلاً الأحد والأربعاء) بتتسجّل كصف
   * مستقل لكل يوم في scheduleSlots، لكن الحقل القديم بيحمل أول يوم اتسجّل بس.
   * الاعتماد عليه كان معناه "حصة اليوم" ممكن تفضل فاضية ليوم الطالب بيحضر فيه
   * فعلاً، أو "جدول الأسبوع" يورّي يوم واحد بس لمجموعة بتقابله مرتين. نفس
   * إصلاح TodayOverviewPanels.tsx (نمط معتمد بالفعل) — مع fallback للمجموعات
   * القديمة اللي معندهاش أي صف في scheduleSlots.
   */
  const myGroupIds = new Set(myGroups.map((g) => g.id));
  const myGroupById = new Map(myGroups.map((g) => [g.id, g]));
  const groupIdsWithAnySlot = new Set(
    state.scheduleSlots
      .filter((sl) => sl.group_id && myGroupIds.has(sl.group_id))
      .map((sl) => sl.group_id!),
  );
  interface WeeklyRow {
    key: string;
    group: (typeof myGroups)[number];
    weekday: string;
    time: string;
    room: string;
  }
  const weeklyRows: WeeklyRow[] = [
    ...state.scheduleSlots
      .filter((sl) => sl.group_id && myGroupIds.has(sl.group_id))
      .map((sl) => {
        const g = myGroupById.get(sl.group_id!)!;
        return {
          key: sl.id,
          group: g,
          weekday: sl.weekday,
          time: sl.time,
          room: sl.room || g.room,
        };
      }),
    ...myGroups
      .filter((g) => !groupIdsWithAnySlot.has(g.id))
      .map((g) => ({
        key: `legacy-${g.id}`,
        group: g,
        weekday: g.weekday,
        time: g.time,
        room: g.room,
      })),
  ];
  const todaysGroups = weeklyRows.filter((r) => r.weekday === today);
  const attendanceByCalendarWeek = buildStudentAttendanceByCalendarWeek(state, me.id);

  return (
    <AppShell
      role="student"
      title={`أهلاً، ${me.full_name}`}
      description={`${me.grade} · ${me.group_name} · كود ${me.code}`}
    >
      <div className="flex items-center gap-3">
        <AvatarUpload
          imageData={me.avatar_data}
          alt="صورة البروفايل"
          onUpload={(dataUrl, mime) => setStudentAvatar(me.id, dataUrl, mime)}
        />
        <p className="text-sm font-bold text-muted-foreground">
          اضغط على أيقونة الكاميرا لتحديث صورة البروفايل.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="نسبة الحضور"
          value={formatPercent(attendanceRate)}
          icon={CalendarCheck}
          tone="success"
        />
        {/* avg_score مُخزَّن داخلياً كنسبة ٠-١٠٠ — المدرس يدخّل كل درجة من ١٠ فعلياً،
            فعرضها بلا تحويل كان يُظهر "٨" كـ"٨٠". القسمة على ١٠ ترجعها لنفس مقياس
            الدرجة الخام المألوف. */}
        <StatCard
          label="متوسط الدرجات (من ١٠)"
          value={formatNumber(me.avg_score / 10)}
          icon={Target}
        />
        <StatCard
          label="نقاط التحفيز"
          value={formatNumber(me.points)}
          icon={Award}
          tone="warning"
        />
        <StatCard
          label="درجة السلوك"
          value={behaviorScore === null ? "—" : `${Math.round(behaviorScore * 10)}/10`}
          icon={Heart}
          tone="primary"
          trend={
            behaviorScore === null
              ? "لم يُقيَّم بعد"
              : behaviorScore >= 0.8
                ? "ممتاز — استمر"
                : behaviorScore >= 0.5
                  ? "جيد"
                  : "يحتاج تحسين"
          }
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="حصة اليوم" description={today ?? ""} className="xl:col-span-1">
          {todaysGroups.length === 0 ? (
            <p className="rounded-xl border-2 border-dashed border-border p-6 text-center text-sm font-bold text-muted-foreground">
              لا يوجد حصص مجدولة اليوم.
            </p>
          ) : (
            <div className="space-y-2">
              {todaysGroups.map((r) => (
                <div key={r.key} className="rounded-xl border-2 border-primary/40 bg-primary/5 p-3">
                  <p className="font-black text-foreground">{r.group.subject}</p>
                  <p className="text-xs font-bold text-muted-foreground">
                    {r.group.teacher_name} · {r.time} · قاعة {r.room}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="جدول الأسبوع" description="كل حصصك في مكان واحد" className="xl:col-span-2">
          {weeklyRows.length === 0 ? (
            <p className="rounded-xl border-2 border-dashed border-border p-6 text-center text-sm font-bold text-muted-foreground">
              لسه مش مسجَّل في أي مجموعة.
            </p>
          ) : (
            <div className="space-y-2">
              {[...weeklyRows]
                .sort(
                  (a, b) =>
                    WEEKDAYS.indexOf(a.weekday as (typeof WEEKDAYS)[number]) -
                    WEEKDAYS.indexOf(b.weekday as (typeof WEEKDAYS)[number]),
                )
                .map((r) => (
                  <div
                    key={r.key}
                    className={
                      r.weekday === today
                        ? "flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-primary bg-primary/5 p-3"
                        : "flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-border p-3"
                    }
                  >
                    <div className="flex items-center gap-2">
                      <CalendarDays className="size-4 text-muted-foreground" />
                      <p className="font-black text-foreground">{r.group.subject}</p>
                    </div>
                    <p className="text-xs font-bold text-muted-foreground">
                      {r.weekday} · {r.time} · {r.group.teacher_name}
                    </p>
                  </div>
                ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="مستواك العام" description="متوسط مُجمَّع عبر كل المواد + مستواك في كل مادة">
        <div className="flex flex-col items-center gap-1 pb-4">
          <p className="kpi-number text-5xl">{formatPercent(overallPerformance.overallAvg)}</p>
          <p className="text-sm font-bold text-muted-foreground">
            عبر {formatNumber(overallPerformance.bySubject.length)} مادة
          </p>
        </div>
        {overallPerformance.bySubject.length > 0 ? (
          <div className="grid grid-cols-2 gap-8 border-t-2 border-border pt-6 sm:grid-cols-3 lg:grid-cols-5">
            {overallPerformance.bySubject.map(({ subject, summary }) => (
              <SubjectGauge
                key={subject.id}
                label={subject.name}
                value={summary.overallAvg}
                size={140}
              />
            ))}
          </div>
        ) : null}
      </Panel>

      <ElectronicHomeworkSection state={state} studentId={me.id} />

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel
          title="ملخّص نتائجي"
          description="واجباتك ومهامك وأنشطتك وسلوكك مُجمَّعة عبر كل موادك"
        >
          <PerformanceChart data={performanceLayers} />
        </Panel>
        <Panel title="حضوري أسبوعياً" description="نسبة الحضور والغياب آخر ٤ أسابيع حقيقية">
          <StudentCalendarWeekAttendanceChart data={attendanceByCalendarWeek} />
        </Panel>
      </div>
    </AppShell>
  );
}
