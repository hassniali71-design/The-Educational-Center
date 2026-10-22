import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, Banknote, Search, Target, Trash2, User, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";

import { Panel, StatCard, StatusBadge } from "@/components/dashboard/StatCard";
import { AppShell } from "@/components/layout/AppShell";
import { AddStudentToGroupModal } from "@/components/owner/AddStudentToGroupModal";
import { GroupCreateModal } from "@/components/owner/GroupCreateModal";
import { StudentDetailSheet } from "@/components/owner/StudentDetailSheet";
import { deleteGroup, getEnrolledCount, useDataStore } from "@/lib/data-store";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Group, Student } from "@/types";

/**
 * §0.3 — صفحة الطلاب:
 *  - 4 كروت حوكمة
 *  - جدول مبسّط (اسم + كود + مجموعة فقط) + اختيار طالب
 *  - بطاقة تفاصيل الطالب (StudentDetailSheet) تفتح فوراً كلوحة جانبية عند الاختيار
 *  - المجموعات الحقيقية تُنشأ هنا (الخطوة 1) وتُجدول من غرفة الجدولة (الخطوة 2)
 */

export const Route = createFileRoute("/owner/students")({
  head: () => ({
    meta: [
      { title: "الطلاب والمجموعات — لوحة المالك" },
      {
        name: "description",
        content: "قاعدة بيانات الطلاب ومستوى كل طالب ومدفوعاته وحضوره.",
      },
    ],
  }),
  component: StudentsPage,
});

const paymentLabel: Record<
  Student["payment_status"],
  { text: string; tone: "success" | "warning" | "destructive" }
> = {
  paid: { text: "مسدد", tone: "success" },
  pending: { text: "قيد السداد", tone: "warning" },
  overdue: { text: "متأخر", tone: "destructive" },
};

function StudentsPage() {
  const state = useDataStore();
  const navigate = useNavigate();
  const { students, groups } = state;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | Student["payment_status"]>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [addStudentGroup, setAddStudentGroup] = useState<Group | null>(null);

  const primaryCount = groups.filter((g) => g.grade.includes("الابتدائي")).length;
  const prepCount = groups.filter((g) => g.grade.includes("الإعدادي") || g.grade.includes("الاعدادي")).length;
  const secondaryCount = groups.length - primaryCount - prepCount;

  const filtered = useMemo(
    () =>
      students.filter(
        (s) =>
          (filter === "all" || s.payment_status === filter) &&
          (s.full_name.includes(query) || s.code.toLowerCase().includes(query.toLowerCase())),
      ),
    [students, query, filter],
  );

  const due = students.reduce((s, st) => s + st.balance_due, 0);
  const avgAttendance =
    students.length === 0
      ? 0
      : Math.round(students.reduce((s, st) => s + st.attendance_rate, 0) / students.length);
  const avgScore =
    students.length === 0 ? 0 : Math.round(students.reduce((s, st) => s + st.avg_score, 0) / students.length);

  return (
    <AppShell
      role="owner"
      title="الطلاب والمجموعات"
      description="سجل الطلاب + نظرة تفصيلية عند اختيار أي طالب"
      actions={
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-navy px-4 py-2.5 text-base font-black text-navy-foreground transition-opacity hover:opacity-90"
        >
          <UserPlus className="size-5" />
          مجموعة جديدة
        </button>
      }
    >
      <GroupCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <AddStudentToGroupModal group={addStudentGroup} onClose={() => setAddStudentGroup(null)} />
      {/* 4 كروت حوكمة */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="إجمالي الطلاب"
          value={formatNumber(students.length)}
          icon={Users}
          trend={`${formatNumber(groups.length)} مجموعة`}
        />
        <StatCard
          label="متوسط الحضور"
          value={formatPercent(avgAttendance)}
          icon={User}
          tone={avgAttendance >= 85 ? "success" : "warning"}
        />
        {/* avgScore مشتق من avg_score (نسبة ٠-١٠٠ داخلياً) — القسمة على ١٠ ترجعه
            لمقياس "من ١٠" اللي المدرس بيدخّل بيه كل درجة فعلياً، بدل عرض ٨٠ مكان ٨. */}
        <StatCard
          label="متوسط الدرجات (من ١٠)"
          value={formatNumber(avgScore / 10)}
          icon={Target}
        />
        <StatCard
          label="إجمالي المستحقات"
          value={formatCurrency(due)}
          icon={Banknote}
          tone={due > 0 ? "destructive" : "success"}
        />
      </div>

      {/* كارت المجموعات الحقيقية (real source) */}
      <Panel
        title="المجموعات الحقيقية"
        description={`${formatNumber(primaryCount)} ابتدائي · ${formatNumber(prepCount)} إعدادي · ${formatNumber(secondaryCount)} ثانوي`}
      >
        {groups.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-border p-6 text-center text-sm font-bold text-muted-foreground">
            لا توجد مجموعات بعد — أنشئ مجموعتك الأولى من زر "مجموعة جديدة" بالأعلى.
          </p>
        ) : (
          <ul className="space-y-2">
            {groups.map((g) => {
              const enrolled = getEnrolledCount(state, g.id);
              return (
              <li
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-black text-foreground">{g.name}</p>
                  <p className="mt-0.5 text-xs font-bold text-muted-foreground">
                    {g.subject} · {g.grade} · مدرس: {g.teacher_name} · {enrolled}/{g.capacity}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {enrolled === 0 ? (
                    <StatusBadge tone="destructive">
                      <AlertCircle className="size-3.5" /> لا يوجد طلاب — لن تظهر لأي طالب
                    </StatusBadge>
                  ) : null}
                  <StatusBadge
                    tone={g.scheduling_status === "scheduled" ? "success" : "warning"}
                  >
                    {g.scheduling_status === "scheduled"
                      ? `مُجدوَلة · ${g.weekday} ${g.time}`
                      : "بانتظار الجدولة"}
                  </StatusBadge>
                  <button
                    type="button"
                    onClick={() => setAddStudentGroup(g)}
                    className="flex items-center gap-1.5 rounded-lg border-2 border-primary/40 px-2.5 py-2 text-xs font-black text-primary hover:border-primary"
                  >
                    <UserPlus className="size-4" /> أضف طالب
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          `هل تريد حذف المجموعة "${g.name}"؟ سيُعاد الطلاب إلى "بدون مجموعة".`,
                        )
                      ) {
                        deleteGroup(g.id);
                        toast.success("تم حذف المجموعة");
                      }
                    }}
                    className="rounded-lg border-2 border-border p-2 text-destructive hover:border-destructive"
                    aria-label="حذف المجموعة"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {/* السجل + البحث + الفلتر + اختيار */}
      <Panel
        title="سجل الطلاب"
        description="ابحث واختر أي طالب لعرض تفاصيله الكاملة"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="بحث بالاسم أو الكود..."
                className="h-11 w-56 rounded-xl border-2 border-border bg-background pr-9 pl-3 text-sm font-bold outline-none focus:border-primary"
              />
            </div>
            {(["all", "paid", "pending", "overdue"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={
                  filter === f
                    ? "rounded-xl border-2 border-navy bg-navy px-3 py-2 text-xs font-black text-navy-foreground"
                    : "rounded-xl border-2 border-border bg-background px-3 py-2 text-xs font-black text-foreground hover:border-primary"
                }
              >
                {f === "all" ? "الكل" : paymentLabel[f].text}
              </button>
            ))}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b-2 border-border text-muted-foreground">
                <th className="pb-3">الطالب</th>
                <th className="pb-3">الكود</th>
                <th className="pb-3">المجموعة</th>
                <th className="pb-3">السداد</th>
                <th className="pb-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  className={cn(
                    "border-b border-border last:border-0 cursor-pointer transition-colors hover:bg-muted/40",
                    selectedId === s.id && "bg-primary/5",
                  )}
                  onClick={() => setSelectedId(s.id)}
                >
                  <td className="py-3">
                    <p className="font-black text-foreground">{s.full_name}</p>
                    <p className="text-xs font-bold text-muted-foreground">{s.grade}</p>
                  </td>
                  <td className="py-3 font-mono font-extrabold">{s.code}</td>
                  <td className="py-3 font-bold text-muted-foreground">{s.group_name}</td>
                  <td className="py-3">
                    <StatusBadge tone={paymentLabel[s.payment_status].tone}>
                      {paymentLabel[s.payment_status].text}
                    </StatusBadge>
                  </td>
                  <td className="py-3 text-left">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId(s.id);
                      }}
                      className="text-sm font-black text-primary hover:underline"
                    >
                      تفاصيل ←
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center font-black text-muted-foreground">
                    لا توجد نتائج مطابقة
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* بطاقة الطالب — تفتح فوراً (Sheet جانبي) بمجرد اختيار طالب من السجل فوق،
          بدل التمرير لأسفل الصفحة بحثاً عنها. */}
      <StudentDetailSheet studentId={selectedId} onClose={() => setSelectedId(null)} />
    </AppShell>
  );
}
