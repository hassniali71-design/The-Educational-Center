import { createFileRoute, Navigate, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenCheck,
  ClipboardList,
  Dices,
  FileText,
  Gamepad2,
  Lightbulb,
  Send,
  Sparkles,
  UserCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Panel, StatusBadge } from "@/components/dashboard/StatCard";
import { AssessmentsTable } from "@/components/teacher/AssessmentsTable";
import { AttendanceRosterBox } from "@/components/teacher/AttendanceRosterBox";
import { ExamsCard } from "@/components/teacher/ExamsCard";
import { GroupResourcesPanel } from "@/components/teacher/GroupResourcesPanel";
import { InteractiveActivityStudio } from "@/components/teacher/InteractiveActivityStudio";
import { LaunchPanel } from "@/components/teacher/LaunchPanel";
import { OwnerNotesCard } from "@/components/teacher/OwnerNotesCard";
import { ReviewUploadPanel } from "@/components/teacher/ReviewUploadPanel";
import { SessionFreeTimer } from "@/components/teacher/SessionFreeTimer";
import { pickFairly } from "@/components/session/FairRandomPicker";
import { InteractiveSlideViewer } from "@/components/session/InteractiveSlideViewer";
import { SessionCurriculumNav } from "@/components/session/SessionCurriculumNav";
import { SessionLessonPlanBanner } from "@/components/session/SessionLessonPlanBanner";
import { SessionReviewPanel } from "@/components/session/SessionReviewPanel";
import { SessionSideNav, type SessionSectionDef } from "@/components/session/SessionSideNav";
import { BookExerciseCard, QuestionCard } from "@/components/session/SessionSteps";
import { SessionTimer } from "@/components/session/SessionTimer";
import { useContentHash } from "@/hooks/use-content-hash";
import { useCountdown } from "@/hooks/use-countdown";
import { useCurrentTeacher } from "@/hooks/use-current-teacher";
import { useSession } from "@/hooks/use-current-student";
import { retryLessonPipeline, runLessonPipeline } from "@/lib/ai/lesson-pipeline";
import { formatNumber } from "@/lib/format";
import { getSession } from "@/lib/auth";
import {
  getBookExerciseTask,
  getCurriculumLessonsForUnit,
  getCurriculumUnitsForSubjectGrade,
  getData,
  getEnrolledCount,
  getNextPlannedLesson,
  getQuestionsForLesson,
  getSessionRecordForLesson,
  getSlidesForLesson,
  getStudentsForGroup,
  recordAssessmentScore,
  recordBookExerciseTask,
  recordQuestionAnswer,
  recordRandomPick,
  recordSessionSummary,
  releaseSessionTasks,
  resolveCurrentTeacher,
  startSessionRecord,
  updateLessonSlide,
  updateQuizQuestion,
  useDataStore,
} from "@/lib/data-store";
import { getSubjectTheme } from "@/lib/subject-themes";
import { cn } from "@/lib/utils";
import type { AttendanceStatus, LiveScore } from "@/types";

/** §7-هـ: مدة تايمر السؤال — الافتراضي 20 ثانية (البند 6). */
const QUESTION_DURATIONS = [10, 20, 30] as const;

/** البند 0 — أقسام الحصة السبعة في قائمة جانبية طولية. */
const SECTIONS: SessionSectionDef[] = [
  {
    key: "attendance",
    title: "سجل الحضور والغياب",
    hint: "حاضر / متأخر بالدقائق / غائب + ملاحظات المالك",
    Icon: UserCheck,
  },
  {
    key: "lesson",
    title: "الشرح التفاعلي",
    hint: "نصائح البدء، مخطط الحصة، روابط المنهج والمرفقات، والشرائح",
    Icon: Lightbulb,
  },
  {
    key: "assessments",
    title: "التقييمات",
    hint: "جدول موحّد لكل أنواع التقييم بما فيها السلوك",
    Icon: ClipboardList,
  },
  {
    key: "launch",
    title: "إطلاق المهام والواجبات",
    hint: "إطلاق جديد + سجل كامل بالحذف فقط",
    Icon: Send,
  },
  {
    key: "activity",
    title: "النشاط التفاعلي",
    hint: "شيت الأسئلة بأربعة أوضاع + سحب طالب عشوائي",
    Icon: Gamepad2,
  },
  {
    key: "reviews",
    title: "المراجعات والامتحانات",
    hint: "رفع ومعاينة الملفات + امتحان بمدة ودرجات",
    Icon: FileText,
  },
  {
    key: "wrapup",
    title: "تمارين الكتاب وختام الحصة",
    hint: "تمارين داخل الحصة، الواجب المنزلي، وإنهاء الحصة",
    Icon: BookOpenCheck,
  },
];

export const Route = createFileRoute("/teacher/session/$groupId")({
  beforeLoad: ({ params }) => {
    const data = getData();
    const group = data.groups.find((g) => g.id === params.groupId);
    if (!group) {
      throw redirect({ to: "/teacher" });
    }
    // نتحقق من ملكية المدرس للمجموعة هنا (قبل ما الصفحة تعرض أي بيانات)، مش بس
    // في useEffect بعد الرسم — عشان بيانات مجموعة مدرس تاني ما تتقراش أصلاً.
    // getSession يعتمد على localStorage فمتاح على المتصفح بس (typeof window check).
    if (typeof window !== "undefined") {
      const session = getSession();
      const teacher = resolveCurrentTeacher(data, session?.identifier);
      if (teacher && group.teacher_id !== teacher.id && group.teacher_user_id !== teacher.user_id) {
        throw redirect({ to: "/teacher" });
      }
    }
  },
  head: () => ({
    meta: [
      { title: "وضع الحصة — المركز الكامل للمجموعة" },
      {
        name: "description",
        content:
          "المنهج، الطلاب، وكل أنواع التقييم لهذه المجموعة في مكان واحد — سبعة أقسام في قائمة جانبية.",
      },
      { property: "og:title", content: "وضع الحصة — المركز الكامل للمجموعة" },
      {
        property: "og:description",
        content: "مركز قيادة الحصة: حضور، شرح، تقييم، إطلاق مهام، أنشطة، امتحانات.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SessionMode,
});

function SessionMode() {
  const { groupId } = Route.useParams();
  const state = useDataStore();
  const { groups, liveScores, attendanceRecords, subjects } = state;
  const group = groups.find((g) => g.id === groupId)!;
  const navigate = useNavigate();
  const teacher = useCurrentTeacher();
  const session = useSession();
  const teacherIdentifier = session?.identifier ?? teacher?.user_id ?? teacher?.id ?? "";

  useEffect(() => {
    if (
      teacher &&
      group.teacher_id !== teacher.id &&
      group.teacher_user_id !== teacher.user_id
    ) {
      toast.error("هذه المجموعة لا تخص المدرس الحالي");
      navigate({ to: "/teacher" });
    }
  }, [teacher, group, navigate]);

  const sessionStudents = useMemo(
    () => getStudentsForGroup(state, group.id),
    [state.students, group.id],
  );
  const theme = getSubjectTheme(subjects.find((s) => s.id === group.subject_id)?.theme_key);
  const { computeHash } = useContentHash();
  const [uploading, setUploading] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("attendance");

  const curriculumUnits = getCurriculumUnitsForSubjectGrade(
    state,
    group.subject_id,
    group.grade_id,
  );
  const [selectedCurriculumLessonId, setSelectedCurriculumLessonId] = useState<string | null>(
    () => getNextPlannedLesson(state, group.subject_id, group.grade_id)?.id ?? null,
  );
  const selectedCurriculumLesson = state.curriculumLessons.find(
    (cl) => cl.id === selectedCurriculumLessonId,
  );
  const selectedLesson = selectedCurriculumLesson?.linked_lesson_id
    ? state.lessons.find((l) => l.id === selectedCurriculumLesson.linked_lesson_id)
    : undefined;
  const selectedLessonReady = selectedLesson?.ai_status === "ready" ? selectedLesson : undefined;
  const groupElectronicHomework = selectedLesson
    ? state.electronicHomeworks.find((eh) => eh.lesson_id === selectedLesson.id)
    : undefined;

  const reviewSessionRecord = selectedLesson
    ? getSessionRecordForLesson(state, selectedLesson.id)
    : undefined;
  const isReviewMode = !!(selectedLesson && reviewSessionRecord);

  const activeSlides = selectedLessonReady
    ? getSlidesForLesson(state, selectedLessonReady.id)
    : state.lessonSlides.filter((s) => s.lesson_id === null);
  const activeQuestionPool = selectedLessonReady
    ? getQuestionsForLesson(state, selectedLessonReady.id)
    : state.sessionQuestions.filter((q) => q.lesson_id === null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [askedCount, setAskedCount] = useState(0);
  const [released, setReleased] = useState(false);
  const [eHomeworkReleased, setEHomeworkReleased] = useState(false);
  const sessionIdRef = useRef(`sess-${Date.now()}`);

  // لازم يتعمل فوراً هنا مش عند "إنهاء الحصة" — بدونه كل تسجيل حضور/تقييم أثناء
  // الحصة كان بيفشل حفظه فعلياً على Supabase (foreign key على session_id لصف
  // session_records لسه مش موجود). انظر تعليق startSessionRecord في data-store.ts.
  useEffect(() => {
    startSessionRecord(sessionIdRef.current, group.id, group.teacher_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scores: LiveScore[] = useMemo(
    () =>
      sessionStudents.map((s) => {
        const live = liveScores.find((l) => l.student_id === s.id);
        return (
          live ?? {
            student_id: s.id,
            student_name: s.full_name,
            homework_score: null,
            question_score: null,
            points: 0,
          }
        );
      }),
    [sessionStudents, liveScores],
  );

  const attendanceStatus = useCallback(
    (studentId: string): AttendanceStatus | null =>
      attendanceRecords.find((a) => a.student_id === studentId && a.group_name === group.name)
        ?.status ?? null,
    [attendanceRecords, group.name],
  );
  const attendedStudentIds = useMemo(
    () =>
      new Set(
        sessionStudents.filter((s) => attendanceStatus(s.id) !== "absent").map((s) => s.id),
      ),
    [sessionStudents, attendanceStatus],
  );

  const [questionDuration, setQuestionDuration] = useState<number>(QUESTION_DURATIONS[1]);
  const questionTimer = useCountdown(questionDuration, () => {
    setAnswered(true);
    toast.error("انتهى وقت السؤال — لم يتم الرد");
  });

  const picked = useMemo(
    () => scores.find((s) => s.student_id === pickedId) ?? null,
    [scores, pickedId],
  );
  const question =
    activeQuestionPool.length > 0
      ? (activeQuestionPool[questionIndex % activeQuestionPool.length] ?? null)
      : null;

  const handleUploadFile = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const contentHash = await computeHash(file);
        const result = await runLessonPipeline({
          file,
          contentHash,
          groupId: group.id,
          subjectId: group.subject_id,
          teacherId: group.teacher_id,
          subjectName: group.subject,
          curriculumLessonId: selectedCurriculumLessonId,
        });
        toast.success(
          result.reusedFromCache
            ? "نفس الملف اتعالج قبل كده — استخدمنا النتيجة المحفوظة فوراً"
            : "تم توليد عرض الدرس بنجاح",
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "فشل رفع الملف — حاول مرة أخرى");
      } finally {
        setUploading(false);
      }
    },
    [
      computeHash,
      group.id,
      group.subject,
      group.subject_id,
      group.teacher_id,
      selectedCurriculumLessonId,
    ],
  );

  const handleRetryLesson = useCallback(async () => {
    if (!selectedLesson) return;
    setUploading(true);
    try {
      await retryLessonPipeline(selectedLesson.id, group.subject);
      toast.success("تم توليد عرض الدرس بنجاح");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشلت إعادة المحاولة");
    } finally {
      setUploading(false);
    }
  }, [selectedLesson, group.subject]);

  const pickRandom = useCallback(() => {
    const next = pickFairly(
      sessionStudents,
      state.randomPickLogs,
      sessionIdRef.current,
      attendedStudentIds,
    );
    if (!next) {
      toast.warning("لا يوجد طلاب حاضرون لسحبهم");
      return;
    }
    recordRandomPick(group.id, next.id, sessionIdRef.current);
    setPickedId(next.id);
    setAnswered(false);
    questionTimer.reset(questionDuration);
    questionTimer.start();
  }, [
    sessionStudents,
    state.randomPickLogs,
    attendedStudentIds,
    group.id,
    questionTimer,
    questionDuration,
  ]);

  const answer = useCallback(
    (correct: boolean) => {
      setAnswered(true);
      questionTimer.pause();
      setAskedCount((c) => c + 1);
      if (pickedId) {
        recordQuestionAnswer(pickedId, correct, sessionIdRef.current);
        recordAssessmentScore({
          studentId: pickedId,
          teacherId: group.teacher_id,
          category: "question",
          source: "auto",
          value: correct ? 10 : 0,
          maxValue: 10,
          sessionId: sessionIdRef.current,
          lessonId: selectedLesson?.id ?? null,
        });
      }
      toast[correct ? "success" : "error"](
        correct ? "إجابة صحيحة — +٥٠ نقطة" : "إجابة خاطئة — تم الرصد",
      );
    },
    [pickedId, questionTimer, group.teacher_id, selectedLesson],
  );

  const releaseTasks = () => {
    releaseSessionTasks(group.id);
    setReleased(true);
    toast.success("تم إطلاق الواجب والشيت الأسبوعي", {
      description: "أُرسلت الإشعارات لحسابات الطلاب وأولياء الأمور عبر واتساب.",
    });
  };

  const handleEndSession = useCallback(() => {
    const attendeesCount = sessionStudents.filter(
      (s) => attendanceStatus(s.id) !== "absent",
    ).length;
    const absenteesCount = sessionStudents.length - attendeesCount;
    const sessionStartMs = Number(sessionIdRef.current.slice("sess-".length));
    const durationSeconds = Math.max(0, Math.round((Date.now() - sessionStartMs) / 1000));
    const participantsCount = new Set(
      state.sessionEvents
        .filter((e) => e.session_id === sessionIdRef.current)
        .map((e) => e.student_id),
    ).size;

    recordSessionSummary({
      sessionId: sessionIdRef.current,
      groupId: group.id,
      teacherId: group.teacher_id,
      lessonId: selectedLesson?.id ?? null,
      attendeesCount,
      absenteesCount,
      questionsAskedCount: askedCount,
      participantsCount,
      homeworkLaunchStatus: released ? "sent" : "not_sent",
      eHomeworkLaunchStatus: eHomeworkReleased ? "sent" : "not_sent",
      activityCompletedInSession: askedCount > 0,
      durationSeconds,
      explanationDurationSeconds: durationSeconds,
      extensionSeconds: 0,
      generalNotes: null,
    });
    toast.success("تم حفظ ملخص الحصة");
    void navigate({ to: "/teacher" });
  }, [
    sessionStudents,
    attendanceStatus,
    state.sessionEvents,
    group.id,
    group.teacher_id,
    selectedLesson,
    askedCount,
    released,
    eHomeworkReleased,
    navigate,
  ]);

  if (
    teacher &&
    group.teacher_id !== teacher.id &&
    group.teacher_user_id !== teacher.user_id
  ) {
    return <Navigate to="/teacher" />;
  }

  return (
    <div dir="rtl" className="min-h-screen bg-canvas">
      <header
        className="sticky top-0 z-20 border-b-2 border-border text-navy-foreground"
        style={{ backgroundColor: theme.primary }}
      >
        <div className="mx-auto flex max-w-[1700px] flex-wrap items-center justify-between gap-4 px-5 py-4 md:px-8">
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/15">
              <theme.icon className="size-6" />
            </span>
            <div>
              <p className="text-xs font-black text-white/70">وضع الحصة — المركز الكامل للمجموعة</p>
              <h1 className="text-2xl font-black md:text-3xl">{group.name}</h1>
              <p className="text-xs font-bold text-white/70">
                {group.teacher_name} · {group.room} · {formatNumber(getEnrolledCount(state, group.id))} طالب
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isReviewMode ? (
              <span className="rounded-xl bg-white/15 px-4 py-2 text-sm font-black">
                وضع مراجعة — {selectedLesson!.title}
              </span>
            ) : null}
            <button
              type="button"
              onClick={handleEndSession}
              className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-black text-navy hover:opacity-90"
            >
              <X className="size-4" /> إنهاء الحصة
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1700px] px-5 py-6 md:px-8">
        <div className="grid gap-6 xl:grid-cols-[300px_1fr]">
          {/* البند 0: القائمة الطولية على يمين الشاشة (RTL) */}
          <div className="space-y-4">
            <SessionSideNav
              sections={SECTIONS}
              activeKey={activeSection}
              onSelect={setActiveSection}
            />
            <aside className="card-crisp p-5">
              <h3 className="mb-4 text-lg font-black">منهج المجموعة</h3>
              <SessionLessonPlanBanner groupId={group.id} teacherId={group.teacher_id} />
              <SessionCurriculumNav
                units={curriculumUnits}
                getLessonsForUnit={(unitId) => getCurriculumLessonsForUnit(state, unitId)}
                selectedCurriculumLessonId={selectedCurriculumLessonId}
                onSelect={(id) => setSelectedCurriculumLessonId(id)}
              />
            </aside>
          </div>

          <section className="space-y-4">
            {/* البند 7: تايمر حر غير إلزامي ثابت أعلى كل قسم */}
            <SessionFreeTimer />

            {isReviewMode && selectedLesson && reviewSessionRecord ? (
              <div className="card-crisp p-6">
                <SessionReviewPanel
                  state={state}
                  lesson={selectedLesson}
                  sessionRecord={reviewSessionRecord}
                  students={sessionStudents}
                  teacherId={group.teacher_id}
                />
              </div>
            ) : null}

            {activeSection === "attendance" ? (
              <div className="grid gap-4 xl:grid-cols-2">
                <AttendanceRosterBox groupId={group.id} />
                <OwnerNotesCard audience="teacher" />
              </div>
            ) : null}

            {activeSection === "lesson" ? (
              <div className="space-y-4">
                <div className="grid gap-4 xl:grid-cols-2">
                  <Panel title="نصائح للبدء" description="افتح الحصة بثبات — أول خمس دقائق تحدد الإيقاع.">
                    <ul className="space-y-2 text-sm font-bold text-muted-foreground">
                      <li className="flex gap-2">
                        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
                        ابدأ بسؤال سريع عن درس الحصة الماضية قبل الشرح.
                      </li>
                      <li className="flex gap-2">
                        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
                        اكتب هدف الحصة على السبورة في جملة واحدة واضحة.
                      </li>
                      <li className="flex gap-2">
                        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
                        تأكد أن سجل الحضور مكتمل قبل بدء الشرح.
                      </li>
                      <li className="flex gap-2">
                        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
                        خصّص آخر خمس دقائق لإطلاق الواجب وتلخيص النقاط.
                      </li>
                    </ul>
                  </Panel>
                  <Panel title="مخطط الحصة" description="خطة الدرس المسجّلة لهذه المجموعة.">
                    <SessionLessonPlanBanner groupId={group.id} teacherId={group.teacher_id} />
                  </Panel>
                </div>

                <GroupResourcesPanel
                  groupId={group.id}
                  teacherId={group.teacher_id}
                  teacherIdentifier={teacherIdentifier}
                  variant="session"
                />

                <div className="card-crisp p-6">
                  {selectedCurriculumLessonId ? (
                    <InteractiveSlideViewer
                      activeLesson={selectedLesson ?? null}
                      busy={uploading}
                      slides={activeSlides}
                      index={slideIndex}
                      onPrev={() => setSlideIndex((i) => Math.max(0, i - 1))}
                      onNext={() =>
                        setSlideIndex((i) => Math.min(activeSlides.length - 1, i + 1))
                      }
                      onFile={(file) => void handleUploadFile(file)}
                      onRetry={() => void handleRetryLesson()}
                      onEditSlide={(slideId, title, bullets) => {
                        updateLessonSlide(slideId, title, bullets);
                        toast.success("تم حفظ التعديل");
                      }}
                    />
                  ) : (
                    <p className="py-10 text-center text-lg font-black text-muted-foreground">
                      اختر درساً من المنهج على اليمين للبدء
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            {activeSection === "assessments" ? (
              <AssessmentsTable
                students={sessionStudents}
                teacherId={group.teacher_id}
                sessionId={sessionIdRef.current}
                lessonId={selectedLesson?.id ?? null}
              />
            ) : null}

            {activeSection === "launch" ? (
              <LaunchPanel groupId={group.id} teacherId={group.teacher_id} variant="curriculum" />
            ) : null}

            {activeSection === "activity" ? (
              <div className="space-y-4">
                <InteractiveActivityStudio
                  group={group}
                  teacherId={group.teacher_id}
                  sessionId={sessionIdRef.current}
                />

                <Panel
                  title="محرك الأسئلة العشوائي"
                  description="سحب طالب حاضر عشوائياً + تايمر السؤال. كل رصد يُحفظ في سجل التقييمات."
                  actions={
                    <button
                      onClick={pickRandom}
                      className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground hover:opacity-90"
                    >
                      <Dices className="size-4" /> اسحب طالباً
                    </button>
                  }
                >
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-black text-muted-foreground">
                        مدة تايمر السؤال:
                      </span>
                      {QUESTION_DURATIONS.map((seconds) => (
                        <button
                          key={seconds}
                          type="button"
                          onClick={() => setQuestionDuration(seconds)}
                          className={cn(
                            "rounded-lg border-2 px-3 py-1.5 text-xs font-black transition-colors",
                            questionDuration === seconds
                              ? "border-navy bg-navy text-navy-foreground"
                              : "border-border hover:border-primary",
                          )}
                        >
                          {formatNumber(seconds)} ثانية
                        </button>
                      ))}
                      <StatusBadge tone="neutral">
                        {formatNumber(askedCount)} سؤال تم رصده
                      </StatusBadge>
                    </div>

                    {picked ? (
                      <div className="rounded-2xl border-2 border-border p-5">
                        <SessionTimer
                          remaining={questionTimer.remaining}
                          running={questionTimer.running}
                          progress={questionTimer.progress}
                          onStart={questionTimer.start}
                          onPause={questionTimer.pause}
                          onReset={() => questionTimer.reset(questionDuration)}
                          size="lg"
                        />
                      </div>
                    ) : null}

                    <QuestionCard
                      student={picked}
                      question={question}
                      answered={answered}
                      onAnswer={answer}
                      onEdit={(questionId, text, options, correctIndex) => {
                        updateQuizQuestion(questionId, text, options, correctIndex);
                        toast.success("تم حفظ التعديل");
                      }}
                    />

                    {/* البند 6: تقليب صريح للسؤال التالي */}
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setQuestionIndex((i) => Math.max(0, i - 1))}
                        className="rounded-xl border-2 border-border px-4 py-2 text-xs font-black"
                      >
                        السؤال السابق
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setQuestionIndex((i) => i + 1);
                          setAnswered(false);
                          setPickedId(null);
                        }}
                        className="rounded-xl bg-navy px-4 py-2 text-xs font-black text-navy-foreground"
                      >
                        السؤال التالي
                      </button>
                    </div>
                  </div>
                </Panel>
              </div>
            ) : null}

            {activeSection === "reviews" ? (
              <div className="space-y-4">
                <ReviewUploadPanel group={group} teacherId={group.teacher_id} />
                <ExamsCard
                  group={group}
                  teacherId={group.teacher_id}
                  sessionId={sessionIdRef.current}
                  students={sessionStudents}
                />
              </div>
            ) : null}

            {activeSection === "wrapup" ? (
              <div className="space-y-4">
                <Panel title="حل تمارين الكتاب — داخل الحصة" description="أرقام الصفحات المطلوب حلها الآن.">
                  <BookExerciseCard
                    title="حل تمارين الكتاب — داخل الحصة"
                    value={
                      getBookExerciseTask(state, sessionIdRef.current, group.id, "in_session")
                        ?.pages_text ?? null
                    }
                    onSave={(pagesText) => {
                      recordBookExerciseTask({
                        sessionId: sessionIdRef.current,
                        groupId: group.id,
                        context: "in_session",
                        pagesText,
                      });
                      toast.success("تم حفظ صفحات التمارين");
                    }}
                  />
                </Panel>

                <Panel
                  title="إطلاق واجب البيت — تمارين الكتاب"
                  description="أرقام الصفحات المطلوبة كواجب منزلي وإرسالها للطلاب وأولياء الأمور."
                >
                  <div className="space-y-4">
                    <BookExerciseCard
                      title="حل تمارين الكتاب — كواجب منزلي"
                      value={
                        getBookExerciseTask(state, sessionIdRef.current, group.id, "homework")
                          ?.pages_text ?? null
                      }
                      onSave={(pagesText) => {
                        recordBookExerciseTask({
                          sessionId: sessionIdRef.current,
                          groupId: group.id,
                          context: "homework",
                          pagesText,
                        });
                        toast.success("تم حفظ صفحات التمارين");
                      }}
                    />
                    <button
                      onClick={releaseTasks}
                      disabled={released}
                      className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-navy text-base font-black text-navy-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      <Send className="size-5" />
                      {released ? "تم الإرسال لجميع الطلاب وأولياء الأمور ✓" : "إطلاق وإرسال الآن"}
                    </button>
                  </div>
                </Panel>

                <Panel
                  title="واجب الويب سايت"
                  description="الواجب الإلكتروني متاح للطلاب 24 ساعة من لحظة الإطلاق، ثم يُغلق تلقائياً."
                >
                  <div className="space-y-3">
                    {groupElectronicHomework ? (
                      <div className="rounded-xl border-2 border-border p-4">
                        <p className="font-black text-foreground">
                          {formatNumber(groupElectronicHomework.questions.length)} سؤال
                        </p>
                        <p className="mt-1 text-xs font-bold text-muted-foreground">
                          آخر موعد للتسليم: {groupElectronicHomework.due_at}
                        </p>
                      </div>
                    ) : (
                      <p className="rounded-xl border-2 border-dashed border-border p-6 text-center text-sm font-bold text-muted-foreground">
                        الواجب الإلكتروني هيتاح بمجرد جاهزية الدرس
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setEHomeworkReleased(true);
                        toast.success("تم تأكيد إتاحة الواجب الإلكتروني");
                      }}
                      disabled={eHomeworkReleased || !groupElectronicHomework}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-navy text-sm font-black text-navy-foreground disabled:opacity-50"
                    >
                      <Send className="size-4" />
                      {eHomeworkReleased ? "تم تأكيد الإتاحة ✓" : "تأكيد الإتاحة للطلاب"}
                    </button>
                  </div>
                </Panel>
              </div>
            ) : null}
          </section>
        </div>
      </main>
    </div>
  );
}
