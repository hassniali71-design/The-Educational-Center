import { BookOpen, Calendar, CircleDollarSign, UserCheck, UserX } from "lucide-react";

import { Panel } from "@/components/dashboard/StatCard";
import { useDataStore } from "@/lib/data-store";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";
import type { AttendanceRecord, BookletSale, PaymentRecord, Task } from "@/types";

/**
 * أحداث اليوم الحقيقية للموظف (read-only):
 *  - آخر 10 مدفوعات اليوم
 *  - آخر 10 مبيعات ملازم اليوم
 *  - آخر 5 حالات late/absent اليوم (لتذكير المتابعة)
 *  - المهام المُنشأة اليوم
 *
 * لا أزرار "إضافة" — الموظف يطّلع فقط.
 */

/**
 * سجلات الغياب مخزَّنة بـ`checked_in_at: "—"` (مفيش وقت حقيقي)، فكانت
 * `isToday("—")` ترجع false دايماً — يعني الغياب ما كان يظهر في "أحداث اليوم"
 * إطلاقاً حتى لو حصل النهارده بالذات. نستخرج التاريخ الحقيقي من معرّف السجل
 * (`at-<epoch-ms>`) اللي بيحمل وقت الإنشاء الفعلي حتى لو checked_in_at كانت "—".
 */
function isToday(iso: string, fallbackId?: string): boolean {
  const t = Date.parse(iso);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const r = new Date();
    return (
      d.getFullYear() === r.getFullYear() &&
      d.getMonth() === r.getMonth() &&
      d.getDate() === r.getDate()
    );
  }
  if (fallbackId) {
    const match = /-(\d{10,})(?:-|$)/.exec(fallbackId);
    if (match) {
      const d = new Date(Number(match[1]));
      if (!Number.isNaN(d.getTime())) {
        const r = new Date();
        return (
          d.getFullYear() === r.getFullYear() &&
          d.getMonth() === r.getMonth() &&
          d.getDate() === r.getDate()
        );
      }
    }
  }
  return iso.startsWith("اليوم");
}

export function DailyStaffEvents() {
  const state = useDataStore();
  const { payments, bookletSales, attendanceRecords, tasks } = state;

  const todayPayments = payments.filter((p) => isToday(p.created_at)).slice(0, 10);
  const todaySales = bookletSales.filter((s) => isToday(s.sold_at)).slice(0, 10);
  const todayLateAbsent = attendanceRecords
    .filter((r) => (r.status === "late" || r.status === "absent") && isToday(r.checked_in_at, r.id))
    .slice(0, 5);
  const todayTasks: Task[] = tasks
    .filter((t) => isToday(t.created_at))
    .slice(0, 10);

  return (
    <Panel
      title="أحداث اليوم"
      description="ما حدث اليوم في السنتر (للاطلاع فقط — بدون إضافة مهام)"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <SubSection title="آخر المدفوعات" icon={CircleDollarSign}>
          {todayPayments.length === 0 ? (
            <EmptyHint />
          ) : (
            todayPayments.map((p: PaymentRecord) => (
              <Row
                key={p.id}
                primary={p.student_name}
                secondary={`${formatCurrency(p.amount)} · ${p.item}`}
                meta={p.created_at}
              />
            ))
          )}
        </SubSection>

        <SubSection title="مبيعات الملازم" icon={BookOpen}>
          {todaySales.length === 0 ? (
            <EmptyHint />
          ) : (
            todaySales.map((s: BookletSale) => (
              <Row
                key={s.id}
                primary={s.student_name}
                secondary={`${s.booklet_title} × ${formatNumber(s.quantity)}`}
                meta={`${formatCurrency(s.total_amount)} · ${formatDateTime(s.sold_at)}`}
              />
            ))
          )}
        </SubSection>

        <SubSection title="حالات تأخير/غياب اليوم" icon={UserX}>
          {todayLateAbsent.length === 0 ? (
            <EmptyHint />
          ) : (
            todayLateAbsent.map((r: AttendanceRecord) => (
              <Row
                key={r.id}
                primary={r.student_name}
                secondary={`${r.group_name} · ${r.status === "absent" ? "غياب" : `تأخير ${r.late_minutes ?? 0} د`}`}
                meta={formatDateTime(r.checked_in_at)}
                icon={r.status === "absent" ? UserX : UserCheck}
              />
            ))
          )}
        </SubSection>

        <SubSection title="مهام اليوم المُسندة" icon={Calendar}>
          {todayTasks.length === 0 ? (
            <EmptyHint />
          ) : (
            todayTasks.map((t) => (
              <Row
                key={t.id}
                primary={t.title}
                secondary={`${t.assignee_name} · ${t.task_type}`}
                meta={formatDateTime(t.created_at)}
              />
            ))
          )}
        </SubSection>
      </div>
    </Panel>
  );
}

function SubSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof CircleDollarSign;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-2 text-sm font-black text-foreground">
        <Icon className="size-4 text-primary" />
        {title}
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({
  primary,
  secondary,
  meta,
  icon: Icon,
}: {
  primary: string;
  secondary: string;
  meta: string;
  icon?: typeof UserX;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border-2 border-border p-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-black">{primary}</p>
        <p className="truncate text-xs text-muted-foreground">{secondary}</p>
      </div>
      <div className="flex items-center gap-1 text-xs font-bold text-muted-foreground">
        {Icon ? <Icon className="size-3.5" /> : null}
        {meta}
      </div>
    </div>
  );
}

function EmptyHint() {
  return (
    <p className="rounded-xl border-2 border-dashed border-border p-3 text-center text-xs font-bold text-muted-foreground">
      لا توجد أحداث اليوم.
    </p>
  );
}
