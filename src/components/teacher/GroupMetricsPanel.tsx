import {
  AlertTriangle,
  Award,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  TrendingUp,
  UserCheck,
  Users,
  UserX,
} from "lucide-react";

import { StatCard } from "@/components/dashboard/StatCard";
import {
  classifyStudent,
  getAssessmentScoresForGroup,
  getSessionRecordsForGroup,
  getStudentsForGroup,
  useDataStore,
} from "@/lib/data-store";
import { formatNumber, formatPercent } from "@/lib/format";
import type { Group } from "@/types";

/**
 * 8 كروت وصفية لمجموعة معيّنة.
 * كلها بيانات حقيقية من `state`:
 *  1. عدد الطلاب
 *  2. المتفوقون
 *  3. يحتاجون تحسيناً
 *  4. متوسط الأداء (avg_score)
 *  5. متوسط الحضور
 *  6. الملتزمون (حضور ≥ 90%)
 *  7. الغائبون آخر حصة
 *  8. عدد التقييمات المسجَّلة
 */
export function GroupMetricsPanel({ group }: { group: Group }) {
  const state = useDataStore();
  const students = getStudentsForGroup(state, group.id);
  const sessions = getSessionRecordsForGroup(state, group.id);
  const assessments = getAssessmentScoresForGroup(state, group.id);

  const excellent = students.filter((s) => classifyStudent(s) === "excellent");
  const needsAttention = students.filter((s) => classifyStudent(s) === "needs_attention");
  const committed = students.filter((s) => s.attendance_rate >= 90);
  const avgScore = students.length
    ? students.reduce((sum, s) => sum + s.avg_score, 0) / students.length
    : 0;
  const avgAttendance = students.length
    ? students.reduce((sum, s) => sum + s.attendance_rate, 0) / students.length
    : 0;

  // آخر حصة مسجّلة
  const lastSession = sessions
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const lastAbsent = lastSession
    ? state.attendanceRecords.filter(
        (a) => a.session_id === lastSession.id && a.status === "absent",
      ).length
    : 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="عدد الطلاب" value={formatNumber(students.length)} icon={Users} />
      <StatCard
        label="المتفوقون"
        value={formatNumber(excellent.length)}
        icon={TrendingUp}
        tone="success"
      />
      <StatCard
        label="يحتاجون تحسيناً"
        value={formatNumber(needsAttention.length)}
        icon={AlertTriangle}
        tone="warning"
      />
      {/* avgScore مُشتق من avg_score (نسبة ٠-١٠٠ داخلياً) — المدرس يدخّل كل درجة من
          ١٠ فعلياً، فالقسمة على ١٠ هنا ترجعها لنفس المقياس بدل عرض ٨٠ مكان ٨. */}
      <StatCard
        label="متوسط الأداء (من ١٠)"
        value={students.length ? formatNumber(Math.round(avgScore) / 10) : "—"}
        icon={Award}
        tone="primary"
      />
      <StatCard
        label="متوسط الحضور"
        value={students.length ? formatPercent(avgAttendance) : "—"}
        icon={UserCheck}
        tone={avgAttendance >= 80 ? "success" : avgAttendance >= 60 ? "warning" : "destructive"}
      />
      <StatCard
        label="الملتزمون (≥ 90%)"
        value={formatNumber(committed.length)}
        icon={CheckCircle2}
        tone="success"
      />
      <StatCard
        label="الغائبون آخر حصة"
        value={formatNumber(lastAbsent)}
        icon={UserX}
        tone={lastAbsent > 0 ? "destructive" : "success"}
      />
      <StatCard
        label="تقييمات مسجَّلة"
        value={formatNumber(assessments.length)}
        icon={ClipboardCheck}
      />
    </div>
  );
}
