import { createFileRoute, Navigate } from "@tanstack/react-router";
import { CheckCheck, Eye, EyeOff, FileUp, Inbox, Search, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Panel, StatusBadge } from "@/components/dashboard/StatCard";
import { AppShell } from "@/components/layout/AppShell";
import { useCurrentStudent } from "@/hooks/use-current-student";
import {
  getGroupsForStudent,
  getTeacherLaunchesForGroup,
  hasSeenLaunch,
  markLaunchSeen,
  useDataStore,
  useIsHydrated,
} from "@/lib/data-store";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { TeacherLaunch } from "@/types";

const NOTE_TONE_META: Record<"positive" | "neutral" | "warning", "success" | "neutral" | "warning"> = {
  positive: "success",
  neutral: "neutral",
  warning: "warning",
};

export const Route = createFileRoute("/student/inbox")({
  head: () => ({
    meta: [
      { title: "الاستقبال — الطالب" },
      {
        name: "description",
        content: "كل ما يرسله مدرّسوك من واجبات ومهام وأنشطة — عرض فقط، بلا أي إدخال بيانات هنا.",
      },
    ],
  }),
  component: InboxPage,
});

const LAUNCH_LABEL: Record<string, string> = {
  homework: "واجب بيتي",
  homework_with_correction: "واجب مع تصحيح",
  in_class_task: "مهمة داخل الحصة",
  interactive_activity: "نشاط تفاعلي",
  online_homework: "واجب إلكتروني",
  online_quiz: "اختبار إلكتروني",
  reading_assignment: "مراجعة / قراءة",
  oral_recitation: "تسميع",
};

/** أنواع بتخزّن بنك أسئلة (شامل الإجابة الصحيحة) داخل body — لا يُعرض نصها للطالب أبداً. */
const STRUCTURED_BODY_TYPES = new Set(["online_homework", "online_quiz"]);

/**
 * "إخفاء من عندي" — مجرد تفضيل عرض شخصي لهذا الطالب على هذا المتصفح، وليس حذفاً
 * للسجل الأصلي (TeacherLaunch يفضل كما هو عند المدرس/النظام بالكامل). نخزّنه في
 * localStorage بمفتاح خاص بكل طالب، مطابقاً لنمط باقي "تفضيلات العرض لكل مستخدم"
 * في المشروع — لا حاجة لجدول/migration جديد لمجرد إخفاء عنصر من قائمة الطالب.
 */
function hiddenLaunchesKey(studentId: string): string {
  return `erp.inbox_hidden.${studentId}`;
}

function readHiddenLaunches(studentId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(hiddenLaunchesKey(studentId));
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function writeHiddenLaunches(studentId: string, ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(hiddenLaunchesKey(studentId), JSON.stringify([...ids]));
  } catch {
    /* localStorage قد يكون معطّلاً في بيئات خاصة */
  }
}

function launchStatus(l: TeacherLaunch, submitted: boolean): { label: string; tone: "success" | "warning" | "destructive" | "neutral" } {
  if (submitted) return { label: "تم التسليم", tone: "success" };
  if (l.due_at && Date.parse(l.due_at) < Date.now()) return { label: "انتهى وقته", tone: "destructive" };
  if (l.due_at) return { label: "مطلوب — له موعد تسليم", tone: "warning" };
  return { label: "للاطلاع", tone: "neutral" };
}

function InboxPage() {
  const state = useDataStore();
  const isHydrated = useIsHydrated();
  const me = useCurrentStudent();
  useEffect(() => {
    if (isHydrated && !me) toast.error("الجلسة منتهية — سجّل الدخول من جديد");
  }, [me, isHydrated]);

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | TeacherLaunch["launch_type"]>("all");
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (me) setHiddenIds(readHiddenLaunches(me.id));
  }, [me?.id]);

  function hideLaunch(launchId: string) {
    if (!me) return;
    const next = new Set(hiddenIds);
    next.add(launchId);
    setHiddenIds(next);
    writeHiddenLaunches(me.id, next);
    toast.success("تم إخفاء العنصر من قائمتك");
  }

  const allLaunches = useMemo(() => {
    if (!me) return [];
    const groups = getGroupsForStudent(state, me.id);
    const all = groups.flatMap((g) => getTeacherLaunchesForGroup(state, g.id));
    return [...all].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [state, me]);

  const launches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allLaunches.filter((l) => {
      if (hiddenIds.has(l.id)) return false;
      if (typeFilter !== "all" && l.launch_type !== typeFilter) return false;
      if (!q) return true;
      const teacherName = state.teachers.find((t) => t.id === l.teacher_id)?.full_name ?? "";
      const group = state.groups.find((g) => g.id === l.group_id);
      const haystack = `${l.title} ${teacherName} ${group?.subject ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [allLaunches, hiddenIds, typeFilter, query, state.teachers, state.groups]);

  const myHomeworkTasks = useMemo(
    () => state.homeworkTasks.filter((h) => h.student_id === me?.id),
    [state.homeworkTasks, me?.id],
  );

  /**
   * "إضافة ملاحظة عن الطالب" من صفحة المالك (owner.students.tsx) كانت تُحفظ
   * فعلياً (addTeacherNote → syncInsert "teacher_notes") لكن ما كانت تظهر في
   * أي مكان عند الطالب نفسه — الطلب الصريح: تظهر هنا تحت "واجبات إدارية".
   */
  const myNotes = useMemo(
    () => state.teacherNotes.filter((n) => n.student_id === me?.id),
    [state.teacherNotes, me?.id],
  );

  if (!isHydrated) return null;
  if (!me) return <Navigate to="/login" />;

  return (
    <AppShell
      role="student"
      title="الاستقبال"
      description="كل ما يرسله مدرّسوك — للاطلاع فقط، من غير أي إدخال بيانات من هنا"
    >
      <Panel
        title="من مدرّسيك"
        description={`${formatNumber(launches.length)} / ${formatNumber(allLaunches.length)} عنصر — عبر كل موادك`}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-xl border-2 border-border px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="بحث باسم المادة أو المدرّس أو عنوان الواجب"
              className="h-10 w-full bg-transparent text-sm font-bold outline-none"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
            className="h-10 rounded-xl border-2 border-border bg-background px-2 text-sm font-black"
          >
            <option value="all">كل الأنواع</option>
            {Object.entries(LAUNCH_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {allLaunches.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-border p-6 text-center text-sm font-bold text-muted-foreground">
            <Inbox className="mx-auto mb-2 size-6 text-muted-foreground" />
            لسه معدش استلمت أي حاجة من مدرّسينك.
          </p>
        ) : launches.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-border p-6 text-center text-sm font-bold text-muted-foreground">
            لا يوجد عنصر مطابق للبحث/الفلتر الحالي.
          </p>
        ) : (
          <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
            {launches.map((l) => {
              const submitted = state.homeworkAttempts.some(
                (a) => a.launch_id === l.id && a.student_id === me.id,
              );
              const seen = hasSeenLaunch(state, l.id, me.id);
              const status = launchStatus(l, submitted);
              const isReading = l.launch_type === "reading_assignment";
              const isFile = isReading && !!l.file_data;
              const Icon = isFile ? FileUp : Send;
              const hidesBody = STRUCTURED_BODY_TYPES.has(l.launch_type);
              return (
                <div
                  key={l.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-xl border-2 border-border bg-background p-3"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-lg bg-primary/10 px-2 py-0.5 text-[11px] font-black text-primary">
                          {LAUNCH_LABEL[l.launch_type] ?? l.launch_type}
                        </span>
                        <p className="truncate text-sm font-black text-foreground">{l.title}</p>
                      </div>
                      {/* أنواع Website/Quiz بتخزّن بنك الأسئلة (شامل الإجابة الصحيحة) في body —
                          نعرضه لغير هذين النوعين بس، عشان إجابة الاختبار ما تتسربش للطالب. */}
                      {l.body && !hidesBody ? (
                        <p className="mt-1 line-clamp-2 text-xs font-bold text-muted-foreground">
                          {l.body}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] font-bold text-muted-foreground">
                        {state.teachers.find((t) => t.id === l.teacher_id)?.full_name ?? "مدرّس"} ·{" "}
                        {formatDateTime(l.created_at)}
                        {l.due_at ? ` · يُسلَّم قبل ${formatDateTime(l.due_at)}` : null}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isFile && l.file_data ? (
                      <a
                        href={`data:${l.file_mime ?? "application/octet-stream"};base64,${l.file_data}`}
                        download={l.file_name ?? l.title}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="rounded-lg border-2 border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-black text-primary hover:bg-primary/20"
                      >
                        تحميل
                      </a>
                    ) : null}
                    {seen ? (
                      <span className="flex items-center gap-1 rounded-lg bg-success/10 px-2.5 py-1 text-[11px] font-black text-success">
                        <CheckCheck className="size-3.5" /> اطلعت عليه
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          markLaunchSeen(l.id, me.id);
                          toast.success("تم تسجيل اطّلاعك");
                        }}
                        className="flex items-center gap-1 rounded-lg border-2 border-border px-2.5 py-1 text-[11px] font-black text-foreground hover:border-primary hover:text-primary"
                      >
                        <Eye className="size-3.5" /> اطلعت عليه
                      </button>
                    )}
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    <button
                      type="button"
                      onClick={() => hideLaunch(l.id)}
                      title="إخفاء من قائمتي (لا يحذف الواجب نفسه)"
                      className="flex items-center gap-1 rounded-lg border-2 border-border px-2 py-1 text-[11px] font-black text-muted-foreground hover:border-destructive hover:text-destructive"
                    >
                      <EyeOff className="size-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel
        title="واجبات إدارية"
        description={`${formatNumber(myHomeworkTasks.length)} واجب مسجَّل`}
      >
        {myHomeworkTasks.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-border p-6 text-center text-sm font-bold text-muted-foreground">
            لا يوجد واجبات إدارية بعد.
          </p>
        ) : (
          <div className="space-y-2">
            {myHomeworkTasks.map((h) => (
              <div
                key={h.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-border p-3"
              >
                <div>
                  <p className="text-sm font-black text-foreground">{h.title}</p>
                  <p className="text-xs font-bold text-muted-foreground">
                    {h.subject} · يُسلَّم {h.due_date}
                  </p>
                </div>
                <StatusBadge
                  tone={
                    h.status === "graded"
                      ? "success"
                      : h.status === "submitted"
                        ? "primary"
                        : h.status === "late"
                          ? "destructive"
                          : "warning"
                  }
                >
                  {h.status === "graded"
                    ? `مصحَّح (${formatNumber(h.grade ?? 0)})`
                    : h.status === "submitted"
                      ? "تم التسليم"
                      : h.status === "late"
                        ? "متأخر"
                        : "مطلوب"}
                </StatusBadge>
              </div>
            ))}
          </div>
        )}

        {myNotes.length > 0 ? (
          <div className="mt-4 border-t-2 border-dashed border-border pt-4">
            <p className="mb-2 text-xs font-black text-muted-foreground">
              ملاحظات ({formatNumber(myNotes.length)})
            </p>
            <div className="space-y-2">
              {myNotes.map((n) => (
                <div
                  key={n.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-xl border-2 border-border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-foreground">{n.note}</p>
                    <p className="mt-1 text-xs font-bold text-muted-foreground">
                      {n.teacher_name} · {n.date}
                    </p>
                  </div>
                  <StatusBadge tone={NOTE_TONE_META[n.tone]}>
                    {n.tone === "positive" ? "إيجابية" : n.tone === "warning" ? "تنبيه" : "ملاحظة"}
                  </StatusBadge>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Panel>
    </AppShell>
  );
}
