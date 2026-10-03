import { Link } from "@tanstack/react-router";
import { Megaphone } from "lucide-react";

import { StatusBadge } from "@/components/dashboard/StatCard";
import { formatNumber, formatPercent } from "@/lib/format";
import type { StudentClassification } from "@/lib/data-store";
import type { Student } from "@/types";

const classificationMeta: Record<
  StudentClassification,
  { text: string; tone: "success" | "warning" | "destructive" }
> = {
  excellent: { text: "ممتاز", tone: "success" },
  average: { text: "متوسط", tone: "warning" },
  needs_attention: { text: "يحتاج متابعة", tone: "destructive" },
};

interface StudentClassificationCardProps {
  student: Student;
  classification: StudentClassification;
  /** Shown only when provided — used by the "طلاب يحتاجون متابعة" panel. */
  reason?: string;
  /**
   * يظهر زرار "إرسال تنبيه" لهذا الطالب لو true — بيوديك لنفس فورم
   * الأوسمة/التنبيهات الموجود بالفعل في صفحة "التقييمات والغياب"
   * (AwardsAndAlertsPanel)، بدل نص حر منفصل بيضيع في مكان تاني.
   */
  showAlertLink?: boolean;
}

export function StudentClassificationCard({
  student,
  classification,
  reason,
  showAlertLink,
}: StudentClassificationCardProps) {
  const meta = classificationMeta[classification];

  return (
    <div className="rounded-xl border-2 border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-black text-foreground">{student.full_name}</p>
        <StatusBadge tone={meta.tone}>{meta.text}</StatusBadge>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-muted-foreground">
        <span>حضور {formatPercent(student.attendance_rate)}</span>
        {/* avg_score مُخزَّن داخلياً كنسبة ٠-١٠٠ — المدرس يدخّل كل درجة من ١٠، فالقسمة
            على ١٠ هنا ترجعها لنفس المقياس بدل عرض ٨٠ مكان ٨. */}
        <span>· متوسط {formatNumber(student.avg_score / 10)}/١٠</span>
      </div>
      {reason ? <p className="mt-2 text-xs font-extrabold text-destructive">{reason}</p> : null}
      {showAlertLink ? (
        <Link
          to="/teacher/assessments"
          search={{ studentId: student.id }}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-warning/40 px-3 py-1.5 text-xs font-black text-warning hover:bg-warning/10"
        >
          <Megaphone className="size-3.5" /> إرسال تنبيه
        </Link>
      ) : null}
    </div>
  );
}
