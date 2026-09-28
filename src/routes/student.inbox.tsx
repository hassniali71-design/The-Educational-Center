import { createFileRoute, Navigate } from "@tanstack/react-router";
import { CheckCheck, Eye, FileUp, Inbox, Send } from "lucide-react";
import { useEffect, useMemo } from "react";
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

  const launches = useMemo(() => {
    if (!me) return [];
    const groups = getGroupsForStudent(state, me.id);
    const all = groups.flatMap((g) => getTeacherLaunchesForGroup(state, g.id));
    return [...all].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [state, me]);

  const myHomeworkTasks = useMemo(
    () => state.homeworkTasks.filter((h) => h.student_id === me?.id),
    [state.homeworkTasks, me?.id],
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
        description={`${formatNumber(launches.length)} عنصر مستلم عبر كل موادك`}
      >
        {launches.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-border p-6 text-center text-sm font-bold text-muted-foreground">
            <Inbox className="mx-auto mb-2 size-6 text-muted-foreground" />
            لسه معدش استلمت أي حاجة من مدرّسينك.
          </p>
        ) : (
          <div className="space-y-2">
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
      </Panel>
    </AppShell>
  );
}
