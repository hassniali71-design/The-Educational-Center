import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";

import {
  ATTENDANCE_STATUS_META,
  BehaviorButtons,
  MiniScoreButtons,
} from "@/components/session/SessionSteps";
import { StatusBadge } from "@/components/dashboard/StatCard";
import { formatNumber } from "@/lib/format";
import {
  getAssessmentScoresForLesson,
  getAttendanceForSession,
  recordAssessmentScore,
  type DataState,
} from "@/lib/data-store";
import { cn } from "@/lib/utils";
import type { AssessmentScore, AttendanceStatus, Lesson, SessionRecord, Student } from "@/types";

const attendanceIcon: Record<AttendanceStatus, typeof CheckCircle2> = {
  present: CheckCircle2,
  late: Clock,
  absent: XCircle,
};

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border-2 border-border p-3">
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-black text-foreground">{value}</p>
    </div>
  );
}

/**
 * CURRICULUM_ENGINE_SPEC.md §13-ب/§13-ج — opens instead of the live 8-step
 * flow once a lesson already has a `SessionRecord` (already taught). Shows
 * what happened, and every score/attendance cell stays editable in place
 * (§13-ج: "تعديل بيانات درس سابق بأثر رجعي... عبر... وضع المراجعة" — this
 * replaces the old separate attendance grid in teacher.assessments.tsx).
 */
export function SessionReviewPanel({
  state,
  lesson,
  sessionRecord,
  students,
  teacherId,
}: {
  state: DataState;
  lesson: Lesson;
  sessionRecord: SessionRecord;
  students: Student[];
  teacherId: string;
}) {
  const scores = getAssessmentScoresForLesson(state, lesson.id);
  const scoreOf = (studentId: string, category: AssessmentScore["category"]) =>
    scores.find((s) => s.student_id === studentId && s.category === category);

  const setScore = (studentId: string, category: AssessmentScore["category"], value: number) => {
    recordAssessmentScore({
      studentId,
      teacherId,
      category,
      source: "manual",
      value,
      maxValue: 10,
      sessionId: sessionRecord.id,
      lessonId: lesson.id,
    });
    toast.success("تم تحديث الدرجة");
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border-2 border-dashed border-border p-4 text-center text-xs font-bold text-muted-foreground">
        وضع مراجعة — هذا الدرس تم تدريسه بتاريخ {sessionRecord.date}. تعديل الدرجات هنا يُحفظ
        فوراً بأثر رجعي. الحضور يسجّله الموظف فقط ويظهر هنا للاطّلاع.
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryStat
          label="الحضور"
          value={`${formatNumber(sessionRecord.attendees_count)} / ${formatNumber(
            sessionRecord.attendees_count + sessionRecord.absentees_count,
          )}`}
        />
        <SummaryStat
          label="أسئلة تم رصدها"
          value={formatNumber(sessionRecord.questions_asked_count)}
        />
        <SummaryStat
          label="واجب البيت"
          value={sessionRecord.homework_launch_status === "sent" ? "تم الإطلاق" : "لم يُطلَق"}
        />
        <SummaryStat
          label="الواجب الإلكتروني"
          value={sessionRecord.e_homework_launch_status === "sent" ? "تم الإطلاق" : "لم يُطلَق"}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-right text-sm">
          <thead>
            <tr className="border-b-2 border-border text-muted-foreground">
              <th className="pb-2">الطالب</th>
              <th className="pb-2">الحضور</th>
              <th className="pb-2">الواجب</th>
              <th className="pb-2">السؤال</th>
              <th className="pb-2">السلوك</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const attendance = getAttendanceForSession(state, s.id, sessionRecord.id);
              const meta = attendance ? ATTENDANCE_STATUS_META[attendance.status] : null;
              const Icon = attendance ? attendanceIcon[attendance.status] : null;
              return (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="py-2 font-black text-foreground">{s.full_name}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-1.5">
                      {meta && Icon ? (
                        <StatusBadge tone={meta.tone}>
                          <Icon className="size-3.5" /> {meta.text}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">لم يُسجَّل</StatusBadge>
                      )}
                    </div>
                  </td>
                  <td className={cn("py-2")}>
                    <MiniScoreButtons
                      current={scoreOf(s.id, "homework")?.value}
                      onScore={(v) => setScore(s.id, "homework", v)}
                    />
                  </td>
                  <td className="py-2">
                    <MiniScoreButtons
                      current={scoreOf(s.id, "question")?.value}
                      onScore={(v) => setScore(s.id, "question", v)}
                    />
                  </td>
                  <td className="py-2">
                    <BehaviorButtons
                      current={scoreOf(s.id, "behavior")?.value}
                      onScore={(v) => setScore(s.id, "behavior", v)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
