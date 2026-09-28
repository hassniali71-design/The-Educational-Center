import { Link, createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  Award,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Layers,
  Send,
  Timer,
  UserX,
  Users,
} from "lucide-react";
import { useEffect } from "react";
import { Navigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { Panel, StatCard, StatusBadge } from "@/components/dashboard/StatCard";
import { AppShell } from "@/components/layout/AppShell";
import { CorrectionPanel } from "@/components/teacher/CorrectionPanel";
import { PlatformTeacherNoteCard } from "@/components/teacher/PlatformTeacherNoteCard";
import { StudentClassificationCard } from "@/components/teacher/StudentClassificationCard";
import { StudentMessagesCard } from "@/components/teacher/StudentMessagesCard";
import { SubjectRoomHeader } from "@/components/teacher/SubjectRoomHeader";
import { useCurrentTeacher } from "@/hooks/use-current-teacher";
import {
  classifyStudent,
  classificationReason,
  getAbsentTodayCountForTeacher,
  getActiveSubjectQuote,
  getEnrolledCount,
  getEventsForTeacherToday,
  getGroupsForTeacher,
  getStudentsForTeacher,
  getTimerCompliance,
  setTeacherAvatar,
  useDataStore,
  useIsHydrated,
} from "@/lib/data-store";
import { formatNumber, formatPercent } from "@/lib/format";
import { getSubjectTheme } from "@/lib/subject-themes";

export const Route = createFileRoute("/teacher/")({
  head: () => ({
    meta: [
      { title: "لوحة المدرس — مركز قيادة الحصص" },
      {
        name: "description",
        content: "مجموعات المدرس ومواعيد الحصص ونسبة الالتزام بالتايمر وبدء وضع الحصة.",
      },
      { property: "og:title", content: "لوحة المدرس — مركز قيادة الحصص" },
      {
        property: "og:description",
        content: "إدارة المجموعات والحصص وبدء وضع العرض التفاعلي بالتايمرات.",
      },
    ],
  }),
  component: TeacherHome,
});

function TeacherHome() {
  const state = useDataStore();
  const { subjects } = state;
  const isHydrated = useIsHydrated();
  const teacher = useCurrentTeacher();
  /**
   * جذر شكوى "المدرسين والطلاب لازم يسجلوا دخول تاني كل ريفريش": `useCurrentTeacher`
   * بيدوّر على صف المدرس داخل `data.teachers` — اللي بيفضل مصفوفة فاضية للحظة
   * قبل ما `bootstrapFromSupabase` يخلص أول ما الصفحة تتحمّل. من غير التحقق من
   * `isHydrated`، الصفحة كانت بتتحس إن "مفيش مدرس" وترجّع لصفحة الدخول فوراً في
   * كل مرة — رغم إن الجلسة سليمة تماماً وبس البيانات لسه بتوصل. صفحات المالك/
   * الموظف ما فيهاش نفس المشكلة لأنها مش محتاجة تدوّر على صف مطابق للجلسة.
   */
  useEffect(() => {
    if (isHydrated && !teacher) toast.error("الجلسة منتهية — سجّل الدخول من جديد");
  }, [teacher, isHydrated]);
  if (!isHydrated) return null;
  if (!teacher) return <Navigate to="/login" />;
  const myGroups = getGroupsForTeacher(state, teacher.id);
  const myStudents = getStudentsForTeacher(state, teacher.id);
  /**
   * مدرس متعدد المواد (Migration 0021) عنده `teacher.subject_id === null` —
   * كان بيرجّع "غرفة المادة" فاضية من أي عبارة أطلقها المالك (`getActiveSubjectQuote`
   * بترجع null فوراً لو subjectId فاضي) رغم إن العبارة مُطلَقة فعلاً، لأن المادة
   * نفسها ما كانتش بتتحدد أصلاً لغير المدرسين أحاديي المادة. نرجع لمادة أول مجموعة
   * فعلية للمدرس كـfallback بدل ما نسيب المادة (والعبارة والثيم) بلا تحديد.
   */
  const resolvedSubjectId = teacher.subject_id ?? myGroups[0]?.subject_id ?? null;
  const subject = subjects.find((s) => s.id === resolvedSubjectId);
  const subjectName = subject?.name ?? teacher.subject;
  const theme = getSubjectTheme(subject?.theme_key);
  const timerCompliance = getTimerCompliance(state, teacher.id);

  const sessionsThisWeek = state.scheduleSlots.filter((s) => s.teacher_id === teacher.id).length;
  const absentToday = getAbsentTodayCountForTeacher(state, teacher.id);
  const committed = myStudents.filter((s) => s.attendance_rate >= 90).length;
  const excellent = myStudents.filter((s) => classifyStudent(s) === "excellent").length;
  const needsAttention = myStudents.filter((s) => classifyStudent(s) === "needs_attention");
  const todayEvents = getEventsForTeacherToday(state, teacher.id);

  return (
    <AppShell role="teacher" title="لوحة المدرس" description={subjectName}>
      <SubjectRoomHeader
        teacher={teacher}
        subjectName={subjectName}
        themeKey={subject?.theme_key}
        theme={theme}
        groupsCount={myGroups.length}
        studentsCount={myStudents.length}
        ownerQuote={getActiveSubjectQuote(state, resolvedSubjectId)?.text}
        onAvatarUpload={(dataUrl, mime) => setTeacherAvatar(teacher.id, dataUrl, mime)}
      />

      <PlatformTeacherNoteCard subjectId={teacher.subject_id} />

      <StudentMessagesCard teacherId={teacher.id} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="عدد الطلاب" value={formatNumber(myStudents.length)} icon={Users} />
        <StatCard
          label="الالتزام بالتايمر"
          value={formatPercent(timerCompliance)}
          icon={Timer}
          tone={timerCompliance >= 90 ? "success" : "warning"}
        />
        <StatCard
          label="حصص هذا الأسبوع"
          value={formatNumber(sessionsThisWeek)}
          icon={CalendarDays}
        />
        <StatCard label="المجموعات" value={formatNumber(myGroups.length)} icon={Layers} />
        <StatCard
          label="الطلاب الملتزمون"
          value={formatNumber(committed)}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          label="الطلاب الغائبون اليوم"
          value={formatNumber(absentToday)}
          icon={UserX}
          tone="destructive"
        />
        <StatCard
          label="الطلاب المتفوقون"
          value={formatNumber(excellent)}
          icon={Award}
          tone="success"
        />
        <StatCard
          label="يحتاجون متابعة"
          value={formatNumber(needsAttention.length)}
          icon={AlertTriangle}
          tone="warning"
        />
      </div>

      {/*
        Migration 0023 / خطة C (C12): أحداث اليوم — المواعيد + المحاولات المعلّقة +
        الإطلاقات الجديدة + تقييمات السلوك. كل ما يخص المدرس فقط.
      */}
      <Panel title="أحداث اليوم" description="مواعيدك + محاولات تنتظر تصحيح + ما أطلقته اليوم">
        {todayEvents.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-border p-6 text-center text-sm font-bold text-muted-foreground">
            لا توجد أحداث اليوم — ابدأ حصة لتظهر هنا.
          </p>
        ) : (
          <div className="space-y-2">
            {todayEvents.slice(0, 12).map((ev) => {
              const Icon =
                ev.kind === "schedule"
                  ? CalendarCheck
                  : ev.kind === "pending_correction"
                    ? ClipboardList
                    : ev.kind === "today_launch"
                      ? Send
                      : CheckCircle2;
              const tone =
                ev.kind === "pending_correction"
                  ? "border-warning/30 bg-warning/5"
                  : ev.kind === "schedule"
                    ? "border-primary/30 bg-primary/5"
                    : "border-border bg-background";
              return (
                <div
                  key={`${ev.kind}-${ev.ref_id}`}
                  className={`flex items-center justify-between gap-3 rounded-xl border-2 p-3 ${tone}`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground/5">
                      <Icon className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black text-foreground">{ev.title}</p>
                      {ev.detail ? (
                        <p className="truncate text-[11px] font-bold text-muted-foreground">
                          {ev.detail}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {ev.at ? (
                    <span className="text-[11px] font-bold text-muted-foreground">
                      {new Date(ev.at).toLocaleTimeString("ar-EG", {
                        hour: "2-digit",
                        minute: "2-digit",
                        numberingSystem: "latn",
                      })}
                    </span>
                  ) : null}
                </div>
              );
            })}
            {todayEvents.length > 12 ? (
              <p className="text-center text-[11px] font-bold text-muted-foreground">
                + {todayEvents.length - 12} حدث آخر
              </p>
            ) : null}
          </div>
        )}
      </Panel>

      {/*
        "أحداث اليوم" فوق كانت بتعرض "محاولات تنتظر تصحيح" كسطر إشعار بحت
        بدون أي إمكانية فعل — الكارت الحقيقي اللي بيصحّح فعلاً (CorrectionPanel)
        كان مبني بالكامل (Migration 0023 / خطة B2) لكن غير مربوط بأي صفحة،
        يعني المدرس مالوش أي طريقة يصحّح بيها واجب إلكتروني اتسلّم. اتربط هنا.
      */}
      <CorrectionPanel variant="dashboard" />

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="جدول مجموعاتي" description="المواعيد والقاعات">
          <div className="space-y-3">
            {myGroups.map((g) => {
              // مجموعة ممكن يكون ليها أكتر من معاد حقيقي (قاعات/أيام مختلفة لنفس
              // الطلاب بالظبط) — نعرضهم كلهم بدل ما نعتمد على g.weekday/g.time
              // (حقل ملخّص قديم بيحمل آخر معاد اتسجّل بس، مش كل المواعيد).
              const slots = state.scheduleSlots
                .filter((sl) => sl.group_id === g.id)
                .sort((a, b) => a.weekday.localeCompare(b.weekday, "ar"));
              return (
                <div key={g.id} className="rounded-xl border-2 border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-black text-foreground">{g.name}</p>
                      <p className="text-xs font-bold text-muted-foreground">
                        {g.grade} · {formatNumber(getEnrolledCount(state, g.id))} طالب
                      </p>
                    </div>
                    <Link
                      to="/teacher/session/$groupId"
                      params={{ groupId: g.id }}
                      className="rounded-xl border-2 border-navy px-3 py-2 text-xs font-black text-navy hover:bg-navy hover:text-navy-foreground"
                    >
                      ابدأ
                    </Link>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {slots.length > 0 ? (
                      slots.map((sl) => (
                        <StatusBadge key={sl.id} tone="primary">
                          {sl.weekday} {sl.time} {sl.room ? `· ${sl.room}` : ""}
                        </StatusBadge>
                      ))
                    ) : (
                      <StatusBadge tone="neutral">لم تُجدول بعد</StatusBadge>
                    )}
                  </div>
                </div>
              );
            })}
            {myGroups.length === 0 ? (
              <p className="py-6 text-center font-black text-muted-foreground">
                لا توجد مجموعات مرتبطة بك بعد
              </p>
            ) : null}
          </div>
        </Panel>

        <Panel title={`مستوى الطلاب في ${subjectName}`} description="المتوسط والتصنيف لكل طالب">
          <div className="grid gap-4">
            {myStudents
              .slice()
              .sort((a, b) => b.avg_score - a.avg_score)
              .map((s) => (
                <StudentClassificationCard
                  key={s.id}
                  student={s}
                  classification={classifyStudent(s)}
                />
              ))}
            {myStudents.length === 0 ? (
              <p className="py-6 text-center font-black text-muted-foreground">
                لا يوجد طلاب مرتبطون بك بعد
              </p>
            ) : null}
          </div>
        </Panel>
      </div>

      <Panel
        title="طلاب يحتاجون متابعة"
        description="حسب التصنيف: متوسط أقل من ٦٠ أو حضور أقل من ٧٥٪"
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {needsAttention.map((s) => (
            <StudentClassificationCard
              key={s.id}
              student={s}
              classification="needs_attention"
              reason={classificationReason(s)}
              showAlertLink
            />
          ))}
          {needsAttention.length === 0 ? (
            <p className="col-span-full py-6 text-center font-black text-muted-foreground">
              لا يوجد طلاب في هذا التصنيف حالياً
            </p>
          ) : null}
        </div>
      </Panel>
    </AppShell>
  );
}
