import { Link, Navigate, createFileRoute } from "@tanstack/react-router";
import { CalendarCheck, MessageSquareText, ShieldCheck, Target, Wallet } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";

import { WeeklyAttendanceChart, ScoreTrendChart } from "@/components/dashboard/Charts";
import { Panel, StatCard, StatusBadge } from "@/components/dashboard/StatCard";
import { AppShell } from "@/components/layout/AppShell";
import { formatCurrency, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { useCurrentStudent } from "@/hooks/use-current-student";
import { useDataStore, useIsHydrated } from "@/lib/data-store";
import { buildStudentAttendanceByWeekday } from "@/lib/owner-metrics";

export const Route = createFileRoute("/parent/")({
  head: () => ({
    meta: [
      { title: "بوابة ولي الأمر — متابعة لحظية" },
      {
        name: "description",
        content: "متابعة حضور الابن ونتائجه اليومية وملاحظات المدرسين وحالة السداد لحظياً.",
      },
      { property: "og:title", content: "بوابة ولي الأمر — متابعة لحظية" },
      {
        property: "og:description",
        content: "كل ما يخص ابنك: الحضور، الدرجات، الواجبات، والإشعارات في مكان واحد.",
      },
    ],
  }),
  component: ParentPortal,
});

function ParentPortal() {
  const state = useDataStore();
  const { quizResults, homeworkTasks, teacherNotes, whatsappLogs, liveScores, attendanceRecords, students } =
    state;
  const isHydrated = useIsHydrated();
  const child = useCurrentStudent();
  useEffect(() => {
    if (isHydrated && !child) toast.error("الجلسة منتهية — سجّل الدخول من جديد");
  }, [child, isHydrated]);
  if (!isHydrated) return null;
  if (!child) return <Navigate to="/login" />;
  const childQuizzes = quizResults.filter((q) => q.student_id === child.id);
  const childHomework = homeworkTasks.filter((h) => h.student_id === child.id);
  const childNotes = teacherNotes.filter((n) => n.student_id === child.id);
  const childLogs = whatsappLogs.filter((w) => w.student_id === child.id);
  const live = liveScores.find((s) => s.student_id === child.id);

  // آخر سجل حضور حقيقي لهذا الطالب — بدل جملة ثابتة "حضر الساعة ٣:٥٢ م" لكل الطلاب.
  const lastAttendance = attendanceRecords
    .filter((a) => a.student_id === child.id)
    .find((a) => !!a.checked_in_at);
  const attendanceStatusLabel =
    lastAttendance?.status === "present"
      ? "حاضر"
      : lastAttendance?.status === "late"
        ? "حضر متأخراً"
        : lastAttendance?.status === "absent"
          ? "غائب"
          : "لا يوجد تسجيل بعد";

  // متوسط درجة الواجب لباقي طلاب نفس المجموعة (استبعاد الطالب نفسه) — بدل جملة ثابتة
  // "أعلى من متوسط المجموعة" كانت بتتكرر لكل الطلاب بلا استثناء.
  const groupmateScores = child.group_id
    ? students
        .filter((s) => s.group_id === child.group_id && s.id !== child.id)
        .map((s) => liveScores.find((l) => l.student_id === s.id)?.homework_score)
        .filter((v): v is number => v != null)
    : [];
  const groupAverage =
    groupmateScores.length > 0
      ? groupmateScores.reduce((a, b) => a + b, 0) / groupmateScores.length
      : null;
  const homeworkComparisonLabel =
    live?.homework_score == null || groupAverage == null
      ? "لا يوجد تقييم بعد"
      : live.homework_score > groupAverage
        ? "أعلى من متوسط المجموعة"
        : live.homework_score < groupAverage
          ? "أقل من متوسط المجموعة"
          : "في متوسط المجموعة";
  const trend = childQuizzes
    .map((q) => ({ label: q.date, score: Math.round((q.score / q.max_score) * 100) }))
    .reverse();

  return (
    <AppShell
      role="parent"
      title={`متابعة: ${child.full_name}`}
      description={`${child.grade} · ${child.group_name} · تحديث لحظي بعد كل حصة`}
      actions={
        <Link
          to="/parent/messages"
          className="flex items-center gap-2 rounded-xl border-2 border-navy px-4 py-2.5 text-sm font-black text-navy hover:bg-navy hover:text-navy-foreground"
        >
          <MessageSquareText className="size-4" /> سجل الواتساب
        </Link>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="نسبة الحضور"
          value={formatPercent(child.attendance_rate)}
          icon={CalendarCheck}
          tone="success"
        />
        {/* avg_score مُخزَّن داخلياً كنسبة ٠-١٠٠ — المدرس يدخّل كل درجة من ١٠ فعلياً،
            فعرضها بلا تحويل كان يُظهر "٨" كـ"٨٠". القسمة على ١٠ ترجعها لنفس مقياس
            الدرجة الخام المألوف. */}
        <StatCard
          label="متوسط الدرجات (من ١٠)"
          value={formatNumber(child.avg_score / 10)}
          icon={Target}
        />
        <StatCard
          label="حالة السداد"
          value={child.payment_status === "paid" ? "مسدد" : formatCurrency(child.balance_due)}
          icon={Wallet}
          tone={child.payment_status === "paid" ? "success" : "destructive"}
        />
        <StatCard
          label="نقاط التحفيز"
          value={formatNumber(child.points)}
          icon={ShieldCheck}
          tone="warning"
        />
      </div>

      <Panel title="حالة اليوم" description="آخر تسجيل حضور وتقييم">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border-2 border-border p-4">
            <p className="text-sm font-black text-muted-foreground">الحضور</p>
            <p className="mt-2 text-xl font-black text-foreground">
              {lastAttendance ? formatDateTime(lastAttendance.checked_in_at) : "—"}
            </p>
            <StatusBadge
              tone={
                lastAttendance?.status === "present"
                  ? "success"
                  : lastAttendance?.status === "late"
                    ? "warning"
                    : lastAttendance?.status === "absent"
                      ? "destructive"
                      : "neutral"
              }
              className="mt-3"
            >
              {attendanceStatusLabel}
            </StatusBadge>
          </div>
          <div className="rounded-xl border-2 border-border p-4">
            <p className="text-sm font-black text-muted-foreground">تقييم الواجب</p>
            <p className="kpi-number mt-2 text-3xl">
              {live?.homework_score != null ? formatNumber(live.homework_score) : "—"} / ١٠
            </p>
            <StatusBadge tone="primary" className="mt-3">
              {homeworkComparisonLabel}
            </StatusBadge>
          </div>
          <div className="rounded-xl border-2 border-border p-4">
            <p className="text-sm font-black text-muted-foreground">سؤال الحصة</p>
            <p className="kpi-number mt-2 text-3xl">
              {live?.question_score != null ? formatNumber(live.question_score) : "—"} / ١٠
            </p>
            <StatusBadge tone={live?.question_score ? "success" : "neutral"} className="mt-3">
              {live?.question_score != null ? "تم الرد على سؤال الحصة" : "لسه ما جاوبش على سؤال في الحصة"}
            </StatusBadge>
          </div>
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="منحنى النتائج" description="نسبة الدرجات في آخر التقييمات">
          <ScoreTrendChart data={trend} />
        </Panel>
        <Panel title="سجل الحضور" description="حضور الابن حقيقي بالأيام هذا الأسبوع">
          <WeeklyAttendanceChart data={buildStudentAttendanceByWeekday(state, child.id)} />
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="ملاحظات المدرسين" description="توصيات المتابعة المنزلية">
          <div className="space-y-3">
            {childNotes.map((n) => (
              <div key={n.id} className="rounded-xl border-2 border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-black text-foreground">{n.teacher_name}</p>
                  <StatusBadge
                    tone={
                      n.tone === "positive"
                        ? "success"
                        : n.tone === "warning"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {n.subject} · {n.date}
                  </StatusBadge>
                </div>
                <p className="mt-2 text-sm font-extrabold text-foreground">{n.note}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="الواجبات المطلوبة" description="تابع التسليم في موعده">
          <div className="space-y-3">
            {childHomework.map((h) => (
              <div
                key={h.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-border p-4"
              >
                <div>
                  <p className="font-black text-foreground">{h.title}</p>
                  <p className="text-xs font-bold text-muted-foreground">
                    {h.subject} · التسليم {h.due_date}
                  </p>
                </div>
                <StatusBadge
                  tone={
                    h.status === "graded"
                      ? "success"
                      : h.status === "submitted"
                        ? "primary"
                        : "warning"
                  }
                >
                  {h.status === "graded"
                    ? "مصحح"
                    : h.status === "submitted"
                      ? "تم التسليم"
                      : "لم يُسلَّم"}
                </StatusBadge>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel
        title="آخر إشعارات الواتساب"
        description="سجل كامل لكل رسالة أُرسلت لولي الأمر"
        actions={
          <Link to="/parent/messages" className="text-sm font-black text-primary hover:underline">
            عرض السجل الكامل
          </Link>
        }
      >
        <div className="space-y-3">
          {childLogs.slice(0, 3).map((w) => (
            <div key={w.id} className="rounded-xl border-2 border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-black text-muted-foreground">{w.sent_at}</p>
                <StatusBadge tone={w.delivered ? "success" : "destructive"}>
                  {w.delivered ? "تم التسليم" : "لم تُسلَّم"}
                </StatusBadge>
              </div>
              <p className="mt-2 text-sm font-extrabold text-foreground">{w.message}</p>
              {w.teacher_name ? (
                <p className="mt-1 text-xs font-bold text-muted-foreground">
                  من: {w.teacher_name}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </Panel>
    </AppShell>
  );
}
