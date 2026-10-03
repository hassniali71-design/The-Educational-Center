import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  Award,
  Banknote,
  BookOpen,
  CalendarCheck,
  GraduationCap,
  Search,
  Star,
  Target,
  Trash2,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Panel, StatCard, StatusBadge } from "@/components/dashboard/StatCard";
import { AppShell } from "@/components/layout/AppShell";
import { AddStudentToGroupModal } from "@/components/owner/AddStudentToGroupModal";
import { GroupCreateModal } from "@/components/owner/GroupCreateModal";
import {
  addTeacherNote,
  classifyStudent,
  deleteGroup,
  getEnrolledCount,
  useDataStore,
} from "@/lib/data-store";
import { formatCurrency, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Group, Student } from "@/types";

/**
 * §0.3 — صفحة الطلاب:
 *  - 4 كروت حوكمة
 *  - جدول مبسّط (اسم + كود + مجموعة فقط) + اختيار طالب
 *  - لوحة تفاصيل الطالب عند الاختيار
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

function isTopPerformerInGroup(student: Student, allStudents: Student[]): boolean {
  const groupmates = allStudents.filter((s) => s.group_id === student.group_id);
  if (groupmates.length === 0) return false;
  const sorted = [...groupmates].sort((a, b) => b.points - a.points);
  const rank = sorted.findIndex((s) => s.id === student.id);
  return (rank + 1) / sorted.length <= 0.2;
}

type StudentVisualStatus = "top" | "attention" | "normal";

function studentVisualStatus(student: Student, allStudents: Student[]): StudentVisualStatus {
  if (classifyStudent(student) === "needs_attention") return "attention";
  if (isTopPerformerInGroup(student, allStudents)) return "top";
  return "normal";
}

const visualStatusMeta: Record<
  StudentVisualStatus,
  { icon: typeof Star; border: string; label: string }
> = {
  top: { icon: Star, border: "border-r-primary", label: "متفوق" },
  attention: { icon: Award, border: "border-r-muted-foreground", label: "يحتاج متابعة" },
  normal: { icon: User, border: "border-r-border", label: "عادي" },
};

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
  const {
    students,
    groups,
    subjects,
    payments,
    attendanceRecords,
    homeworkTasks,
    teacherNotes,
  } = state;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | Student["payment_status"]>("all");
  const [noteDraft, setNoteDraft] = useState("");
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

  const selected = selectedId ? students.find((s) => s.id === selectedId) ?? null : null;
  const studentPayments = selected
    ? payments.filter((p) => p.student_code === selected.code)
    : [];
  const studentAttendance = selected
    ? attendanceRecords.filter((a) => a.student_id === selected.id)
    : [];
  const studentHomework = selected
    ? homeworkTasks.filter((h) => h.student_id === selected.id)
    : [];
  const studentNotes = selected
    ? teacherNotes.filter((n) => n.student_id === selected.id)
    : [];
  const studentSubjectNames = selected
    ? selected.subject_ids
        .map((id) => subjects.find((s) => s.id === id)?.name)
        .filter((n): n is string => Boolean(n))
    : [];
  const pendingHomeworkCount = studentHomework.filter((h) => h.status === "pending").length;
  const selectedStatus = selected ? studentVisualStatus(selected, students) : null;

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

      {/* نظرة عامة مبسّطة — كبطاقات */}
      <Panel title="نظرة الطلاب البصرية" description="متفوق / يحتاج متابعة / عادي">
        {students.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-border p-6 text-center text-sm font-bold text-muted-foreground">
            لا يوجد طلاب بعد — أضف من /owner/access.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {students.map((s) => {
              const status = studentVisualStatus(s, students);
              const meta = visualStatusMeta[status];
              return (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={cn(
                    "rounded-xl border-2 border-r-4 border-border p-4 text-right transition-colors hover:border-primary",
                    meta.border,
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-black text-foreground">{s.full_name}</p>
                    <meta.icon className="size-4 shrink-0 text-muted-foreground" />
                  </div>
                  <p className="mt-1 text-xs font-bold text-muted-foreground">{s.group_name}</p>
                  <p className="mt-2 text-xs font-extrabold text-muted-foreground">
                    {formatNumber(s.points)} نقطة · {formatPercent(s.attendance_rate)} حضور
                  </p>
                </button>
              );
            })}
          </div>
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

      {/* كارت الطالب الشامل — اختر من السجل فوق (بحث بالاسم/الكود) ليظهر هنا */}
      {selected ? (
        <Panel
          title="كارت الطالب"
          description="كل تفاصيل الطالب في مكان واحد — من السجل والبحث بالأعلى"
          actions={
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="text-sm font-black text-muted-foreground hover:text-foreground"
            >
              إغلاق
            </button>
          }
        >
          <div className="flex flex-wrap items-center gap-4 rounded-xl border-2 border-border bg-canvas/30 p-4">
            {selected.avatar_data ? (
              <img
                src={selected.avatar_data}
                alt={selected.full_name}
                className="size-16 shrink-0 rounded-2xl border-2 border-border object-cover"
              />
            ) : (
              <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl border-2 border-border bg-muted text-2xl font-black text-muted-foreground">
                {selected.full_name.trim().charAt(0) || "؟"}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xl font-black text-foreground">{selected.full_name}</p>
              <p className="mt-0.5 text-sm font-bold text-muted-foreground">
                الكود: {selected.code} · {selected.grade} · {selected.group_name}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <StatusBadge tone={paymentLabel[selected.payment_status].tone}>
                  {paymentLabel[selected.payment_status].text}
                </StatusBadge>
                {selectedStatus ? (
                  <StatusBadge
                    tone={
                      selectedStatus === "top"
                        ? "success"
                        : selectedStatus === "attention"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {visualStatusMeta[selectedStatus].label}
                  </StatusBadge>
                ) : null}
                {pendingHomeworkCount > 0 ? (
                  <StatusBadge tone="warning">
                    {formatNumber(pendingHomeworkCount)} واجب متبقٍ
                  </StatusBadge>
                ) : null}
                {studentSubjectNames.map((name) => (
                  <StatusBadge key={name} tone="primary">
                    {name}
                  </StatusBadge>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <DetailStat label="نقاط لوحة الشرف" value={formatNumber(selected.points)} />
            <DetailStat label="نسبة الحضور" value={formatPercent(selected.attendance_rate)} />
            {/* avg_score مُخزَّن داخلياً كنسبة ٠-١٠٠ (averagePercent) لاستخدامه في عتبات
                classifyStudent — لكن المدرس يدخل كل درجة من ١٠ (AssessmentsTable/
                StudentScoreKeyboard)، فعرضها هنا بلا أي تحويل كان يُظهر "٨" كـ"٨٠"
                (نسبة بلا علامة %، تبدو كأنها الدرجة الخام مضروبة في ١٠). القسمة على
                ١٠ ترجعها لنفس مقياس الدرجة الخام المألوف للمدرس والطالب. */}
            <DetailStat label="متوسط الدرجات (من ١٠)" value={formatNumber(selected.avg_score / 10)} />
            <DetailStat
              label="المستحق"
              value={formatCurrency(selected.balance_due)}
              tone={selected.balance_due > 0 ? "warning" : "success"}
            />
          </div>

          <div className="mt-5 grid gap-6 lg:grid-cols-2">
            <SubPanel title="المدفوعات" icon={Banknote}>
              {studentPayments.length === 0 ? (
                <p className="text-sm font-bold text-muted-foreground">لا توجد مدفوعات مسجّلة.</p>
              ) : (
                <ul className="space-y-1">
                  {studentPayments.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-2 text-sm font-bold text-foreground"
                    >
                      <span>{p.item}</span>
                      <span className="text-success">{formatCurrency(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SubPanel>

            <SubPanel title="سجل الحضور" icon={CalendarCheck}>
              {studentAttendance.length === 0 ? (
                <p className="text-sm font-bold text-muted-foreground">لا توجد سجلات حضور.</p>
              ) : (
                <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
                  {studentAttendance.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-2 text-sm font-bold text-foreground"
                    >
                      <span>{a.checked_in_at}</span>
                      <StatusBadge
                        tone={
                          a.status === "present"
                            ? "success"
                            : a.status === "late"
                              ? "warning"
                              : "destructive"
                        }
                      >
                        {a.status === "present"
                          ? "حاضر"
                          : a.status === "late"
                            ? "متأخر"
                            : "غائب"}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
            </SubPanel>

            <SubPanel title="الواجبات" icon={BookOpen}>
              {studentHomework.length === 0 ? (
                <p className="text-sm font-bold text-muted-foreground">لا توجد واجبات.</p>
              ) : (
                <ul className="space-y-1">
                  {studentHomework.map((h) => (
                    <li
                      key={h.id}
                      className="flex items-center justify-between gap-2 text-sm font-bold text-foreground"
                    >
                      <span>{h.title}</span>
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
                        {h.status === "pending"
                          ? "لم يُسلَّم"
                          : h.status === "submitted"
                            ? "تم التسليم"
                            : h.status === "graded"
                              ? `مُصحَّح (${h.grade ?? "—"})`
                              : "متأخر"}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
            </SubPanel>

            <SubPanel title="ملاحظات المدرسين" icon={GraduationCap}>
              {studentNotes.length === 0 ? (
                <p className="text-sm font-bold text-muted-foreground">لا توجد ملاحظات.</p>
              ) : (
                <ul className="space-y-1">
                  {studentNotes.map((n) => (
                    <li key={n.id} className="rounded-lg border border-border p-2">
                      <p className="text-sm font-black text-foreground">{n.note}</p>
                      <p className="mt-0.5 text-xs font-bold text-muted-foreground">
                        {n.teacher_name} · {n.subject} · {formatDateTime(n.date)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </SubPanel>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-2">
            <label className="block flex-1 min-w-64">
              <span className="mb-1.5 block text-xs font-black text-muted-foreground">
                إضافة ملاحظة للطالب
              </span>
              <input
                type="text"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="اكتب ملاحظة قصيرة (تظهر في سجل المدرّس)"
                className="w-full rounded-xl border-2 border-border bg-background px-3 py-2 text-sm font-bold text-foreground outline-none focus:border-primary"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                if (!noteDraft.trim()) {
                  toast.error("اكتب نص الملاحظة أولاً");
                  return;
                }
                if (!selected) return;
                const studentGroup = groups.find((g) => g.id === selected.group_id);
                const teacherId = studentGroup?.teacher_id;
                if (!teacherId) {
                  toast.error("الطالب غير مسجّل في مجموعة لها مدرس بعد");
                  return;
                }
                addTeacherNote(selected.id, teacherId, noteDraft);
                setNoteDraft("");
                toast.success("تم حفظ الملاحظة");
              }}
              className="rounded-xl border-2 border-primary bg-primary/10 px-4 py-2 text-sm font-black text-primary"
            >
              حفظ الملاحظة
            </button>
          </div>
        </Panel>
      ) : null}
    </AppShell>
  );
}

function DetailStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "destructive";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border-2 p-3",
        tone === "success" && "border-success/40 bg-success/5",
        tone === "warning" && "border-warning/40 bg-warning/5",
        tone === "destructive" && "border-destructive/40 bg-destructive/5",
        !tone && "border-border",
      )}
    >
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <p className="kpi-number text-xl">{value}</p>
    </div>
  );
}

function SubPanel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Banknote;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border-2 border-border p-4">
      <p className="mb-2 flex items-center gap-2 text-sm font-black text-foreground">
        <Icon className="size-4 text-primary" />
        {title}
      </p>
      {children}
    </div>
  );
}
