import {
  AlertTriangle,
  Award,
  Banknote,
  BookMarked,
  BookOpen,
  CalendarCheck,
  GraduationCap,
  Loader2,
  Pencil,
  Phone,
  Plus,
  Star,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/dashboard/StatCard";
import { OwnerPasswordConfirmModal } from "@/components/owner/OwnerPasswordConfirmModal";
import { deleteAccount, getAccounts } from "@/lib/auth";
import {
  addStudentToGroup,
  addSubjectToStudent,
  addTeacherNote,
  classifyStudent,
  classificationReason,
  computeStudentFees,
  deleteAccountCascade,
  enrollStudentInAdditionalGroup,
  getEnrolledCount,
  getGroupsForStudent,
  getSubjectsForGrade,
  removeSubjectFromStudent,
  unenrollStudentFromAdditionalGroup,
  updateStudentBasicInfo,
  useDataStore,
} from "@/lib/data-store";
import { formatCurrency, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const paymentLabel: Record<"paid" | "pending" | "overdue", { text: string; tone: "success" | "warning" | "destructive" }> = {
  paid: { text: "مسدد", tone: "success" },
  pending: { text: "قيد السداد", tone: "warning" },
  overdue: { text: "متأخر", tone: "destructive" },
};

interface StudentDetailSheetProps {
  studentId: string | null;
  onClose: () => void;
}

/**
 * بطاقة الطالب — بتفتح فوراً (Sheet جانبي واسع) من أي ضغطة على طالب في السجل، بدل
 * التمرير لأسفل الصفحة بحثاً عنها. كل الأقسام جوّه لوحة واحدة بتمرير داخلي.
 */
export function StudentDetailSheet({ studentId, onClose }: StudentDetailSheetProps) {
  const state = useDataStore();
  const { students, groups, subjects, payments, attendanceRecords, homeworkTasks, teacherNotes } = state;
  const student = studentId ? students.find((s) => s.id === studentId) ?? null : null;

  const [editingBasic, setEditingBasic] = useState(false);
  const [basicDraft, setBasicDraft] = useState({ fullName: "", guardianName: "", guardianPhone: "" });
  const [noteDraft, setNoteDraft] = useState("");
  const [addingSubject, setAddingSubject] = useState(false);
  const [newSubjectId, setNewSubjectId] = useState("");
  const [newSubjectGroupId, setNewSubjectGroupId] = useState("");
  const [newSubjectFee, setNewSubjectFee] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteNameInput, setDeleteNameInput] = useState("");
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!student) return;
    setEditingBasic(false);
    setAddingSubject(false);
    setConfirmingDelete(false);
    setDeleteNameInput("");
    setShowPasswordConfirm(false);
    setBasicDraft({
      fullName: student.full_name,
      guardianName: student.guardian_name,
      guardianPhone: student.guardian_phone,
    });
    let cancelled = false;
    void getAccounts().then((accounts) => {
      if (cancelled) return;
      const account = accounts.find((a) => a.identifier === student.code && a.role === "student");
      setAccountId(account?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  const studentPayments = useMemo(
    () => (student ? payments.filter((p) => p.student_code === student.code) : []),
    [payments, student],
  );
  const studentAttendance = useMemo(
    () => (student ? attendanceRecords.filter((a) => a.student_id === student.id) : []),
    [attendanceRecords, student],
  );
  const studentHomework = useMemo(
    () => (student ? homeworkTasks.filter((h) => h.student_id === student.id) : []),
    [homeworkTasks, student],
  );
  const studentNotes = useMemo(
    () => (student ? teacherNotes.filter((n) => n.student_id === student.id) : []),
    [teacherNotes, student],
  );
  const studentGroups = useMemo(
    () => (student ? getGroupsForStudent(state, student.id) : []),
    [state, student],
  );
  const totalPaid = studentPayments.reduce((sum, p) => sum + p.amount, 0);
  const addableSubjects = useMemo(() => {
    if (!student) return [];
    const forGrade = subjects.filter((s) => {
      const grade = state.grades.find((g) => g.name === student.grade);
      return grade ? getSubjectsForGrade(state, grade.id).some((x) => x.id === s.id) : false;
    });
    return forGrade.filter((s) => !student.subject_ids.includes(s.id));
  }, [state, student, subjects]);
  const groupsForNewSubject = useMemo(() => {
    if (!student || !newSubjectId) return [];
    return groups.filter((g) => g.subject_id === newSubjectId && g.grade === student.grade);
  }, [groups, newSubjectId, student]);

  if (!student) return null;

  const status = classifyStudent(student);
  const totalHomeworkPending = studentHomework.filter((h) => h.status === "pending").length;

  function saveBasicInfo() {
    if (!basicDraft.fullName.trim()) {
      toast.error("اسم الطالب مطلوب");
      return;
    }
    updateStudentBasicInfo(student!.id, {
      fullName: basicDraft.fullName,
      guardianName: basicDraft.guardianName,
      guardianPhone: basicDraft.guardianPhone,
    });
    setEditingBasic(false);
    toast.success("تم حفظ تعديل بيانات الطالب");
  }

  function openAddSubject() {
    setAddingSubject(true);
    setNewSubjectId("");
    setNewSubjectGroupId("");
    setNewSubjectFee("");
  }

  function confirmAddSubject() {
    if (!newSubjectId) {
      toast.error("اختر مادة أولاً");
      return;
    }
    const fee = Number(newSubjectFee) || 0;
    const result = addSubjectToStudent(student!.id, newSubjectId, fee, newSubjectGroupId || null);
    if (!result.ok) {
      toast.error(result.reason ?? "تعذّرت إضافة المادة");
      return;
    }
    if (result.reason) {
      toast.success("تمت إضافة المادة");
      toast.error(`لكن: ${result.reason} — تقدر تربطها بمجموعة لاحقاً`);
    } else {
      toast.success("تمت إضافة المادة وربطها بالمجموعة");
    }
    setAddingSubject(false);
  }

  function handleRemoveSubject(subjectId: string, subjectName: string) {
    if (!window.confirm(`إزالة "${subjectName}" من تسجيل ${student!.full_name}؟ سيتوقف التسجيل المستقبلي فقط — السجلات والمدفوعات السابقة تفضل كما هي.`)) {
      return;
    }
    const result = removeSubjectFromStudent(student!.id, subjectId);
    if (result.ok) toast.success("تمت إزالة المادة");
    else toast.error(result.reason ?? "تعذّرت الإزالة");
  }

  function changeGroupForSubject(currentGroupId: string, newGroupId: string) {
    if (!newGroupId || newGroupId === currentGroupId) return;
    const isPrimary = student!.group_id === currentGroupId;
    if (isPrimary) {
      const result = addStudentToGroup(student!.id, newGroupId);
      if (!result.ok) {
        toast.error(result.reason ?? "تعذّر النقل");
        return;
      }
    } else {
      const enrollment = state.studentGroupEnrollments.find(
        (e) => e.student_id === student!.id && e.group_id === currentGroupId,
      );
      const result = enrollStudentInAdditionalGroup(student!.id, newGroupId);
      if (!result.ok) {
        toast.error(result.reason ?? "تعذّر النقل");
        return;
      }
      if (enrollment) unenrollStudentFromAdditionalGroup(enrollment.id);
    }
    toast.success("تم نقل الطالب للمجموعة الجديدة");
  }

  async function runDelete() {
    setBusy(true);
    try {
      if (accountId) {
        try {
          await deleteAccount(accountId);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "فشل حذف حساب الدخول");
          return;
        }
        const result = deleteAccountCascade(accountId, student!.code, "student");
        if (!result.ok) {
          toast.error(result.error ?? "فشل الحذف");
          return;
        }
      } else {
        // لا يوجد حساب دخول مرتبط (حالة نادرة) — نحذف سجل الطالب التشغيلي فقط.
        deleteAccountCascade("", student!.code, "student");
      }
      toast.success(`تم حذف الطالب ${student!.full_name} نهائياً من النظام`);
      onClose();
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
      setDeleteNameInput("");
      setShowPasswordConfirm(false);
    }
  }

  return (
    <Sheet open={!!studentId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl lg:max-w-2xl"
      >
        <SheetHeader className="border-b-2 border-border p-5 text-right">
          <div className="flex items-start gap-4">
            {student.avatar_data ? (
              <img
                src={student.avatar_data}
                alt={student.full_name}
                className="size-16 shrink-0 rounded-2xl border-2 border-border object-cover"
              />
            ) : (
              <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl border-2 border-border bg-muted text-2xl font-black text-muted-foreground">
                {student.full_name.trim().charAt(0) || "؟"}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-xl">{student.full_name}</SheetTitle>
              <p className="mt-0.5 text-sm font-bold text-muted-foreground">
                الكود: {student.code} · {student.grade}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <StatusBadge tone={paymentLabel[student.payment_status].tone}>
                  {paymentLabel[student.payment_status].text}
                </StatusBadge>
                <StatusBadge
                  tone={status === "needs_attention" ? "warning" : status === "excellent" ? "success" : "neutral"}
                >
                  {status === "needs_attention" ? (
                    <Award className="size-3.5" />
                  ) : status === "excellent" ? (
                    <Star className="size-3.5" />
                  ) : (
                    <User className="size-3.5" />
                  )}
                  {status === "needs_attention" ? "يحتاج متابعة" : status === "excellent" ? "متفوق" : "عادي"}
                </StatusBadge>
              </div>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {/* البيانات الأساسية */}
          <section className="rounded-xl border-2 border-border p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-black text-foreground">
                <User className="size-4 text-primary" /> البيانات الأساسية
              </p>
              <button
                type="button"
                onClick={() => (editingBasic ? saveBasicInfo() : setEditingBasic(true))}
                className="flex items-center gap-1 text-xs font-black text-primary hover:underline"
              >
                <Pencil className="size-3.5" /> {editingBasic ? "حفظ" : "تعديل"}
              </button>
            </div>
            {editingBasic ? (
              <div className="space-y-2">
                <input
                  value={basicDraft.fullName}
                  onChange={(e) => setBasicDraft((d) => ({ ...d, fullName: e.target.value }))}
                  placeholder="اسم الطالب"
                  className="w-full rounded-lg border-2 border-border bg-background px-3 py-2 text-sm font-bold outline-none focus:border-primary"
                />
                <input
                  value={basicDraft.guardianName}
                  onChange={(e) => setBasicDraft((d) => ({ ...d, guardianName: e.target.value }))}
                  placeholder="اسم ولي الأمر"
                  className="w-full rounded-lg border-2 border-border bg-background px-3 py-2 text-sm font-bold outline-none focus:border-primary"
                />
                <input
                  value={basicDraft.guardianPhone}
                  onChange={(e) => setBasicDraft((d) => ({ ...d, guardianPhone: e.target.value }))}
                  placeholder="هاتف ولي الأمر"
                  inputMode="tel"
                  className="w-full rounded-lg border-2 border-border bg-background px-3 py-2 text-sm font-bold outline-none focus:border-primary"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingBasic(false)}
                    className="rounded-lg border-2 border-border px-3 py-1.5 text-xs font-black text-foreground"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs font-bold text-muted-foreground">ولي الأمر</dt>
                  <dd className="font-black text-foreground">{student.guardian_name || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold text-muted-foreground">هاتف ولي الأمر</dt>
                  <dd className="flex items-center gap-1 font-black text-foreground">
                    <Phone className="size-3.5 text-muted-foreground" /> {student.guardian_phone || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-bold text-muted-foreground">المجموعة الأساسية</dt>
                  <dd className="font-black text-foreground">{student.group_name}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold text-muted-foreground">نقاط لوحة الشرف</dt>
                  <dd className="font-black text-foreground">{formatNumber(student.points)}</dd>
                </div>
              </dl>
            )}
            <p className="mt-3 text-xs font-bold text-muted-foreground">{classificationReason(student)}</p>
          </section>

          {/* المواد والمجموعات */}
          <section className="rounded-xl border-2 border-border p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-black text-foreground">
                <BookMarked className="size-4 text-primary" /> المواد والمجموعات
              </p>
              <button
                type="button"
                onClick={openAddSubject}
                className="flex items-center gap-1 text-xs font-black text-primary hover:underline"
              >
                <Plus className="size-3.5" /> إضافة مادة
              </button>
            </div>

            {addingSubject ? (
              <div className="mb-3 space-y-2 rounded-lg border-2 border-dashed border-primary bg-primary/5 p-3">
                <select
                  value={newSubjectId}
                  onChange={(e) => {
                    setNewSubjectId(e.target.value);
                    setNewSubjectGroupId("");
                    const fees = computeStudentFees(state, [e.target.value]);
                    setNewSubjectFee(String(fees.monthly || fees.perSession || 0));
                  }}
                  className="w-full rounded-lg border-2 border-border bg-background px-3 py-2 text-sm font-bold outline-none focus:border-primary"
                >
                  <option value="">اختر المادة</option>
                  {addableSubjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {newSubjectId ? (
                  <select
                    value={newSubjectGroupId}
                    onChange={(e) => setNewSubjectGroupId(e.target.value)}
                    className="w-full rounded-lg border-2 border-border bg-background px-3 py-2 text-sm font-bold outline-none focus:border-primary"
                  >
                    <option value="">بدون مجموعة الآن (تحدَّد لاحقاً)</option>
                    {groupsForNewSubject.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} · {g.teacher_name} · {g.weekday} {g.time} ({getEnrolledCount(state, g.id)}/{g.capacity})
                      </option>
                    ))}
                  </select>
                ) : null}
                <div className="flex items-center gap-2">
                  <label className="text-xs font-black text-muted-foreground">الاشتراك المتوقع</label>
                  <input
                    type="number"
                    value={newSubjectFee}
                    onChange={(e) => setNewSubjectFee(e.target.value)}
                    className="w-32 rounded-lg border-2 border-border bg-background px-2 py-1.5 text-sm font-bold outline-none focus:border-primary"
                  />
                  <span className="text-xs font-bold text-muted-foreground">جنيه</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={confirmAddSubject}
                    className="rounded-lg bg-navy px-3 py-1.5 text-xs font-black text-navy-foreground"
                  >
                    تأكيد الإضافة
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddingSubject(false)}
                    className="rounded-lg border-2 border-border px-3 py-1.5 text-xs font-black text-foreground"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            ) : null}

            {student.subject_ids.length === 0 ? (
              <p className="text-sm font-bold text-muted-foreground">لا توجد مواد مسجَّلة.</p>
            ) : (
              <ul className="space-y-2">
                {student.subject_ids.map((subjectId) => {
                  const subject = subjects.find((s) => s.id === subjectId);
                  const group = studentGroups.find((g) => g.subject_id === subjectId);
                  const alternativeGroups = group
                    ? groups.filter(
                        (g) => g.subject_id === subjectId && g.grade === student.grade && g.id !== group.id,
                      )
                    : [];
                  const fee = student.subject_fees?.[subjectId] ?? 0;
                  return (
                    <li key={subjectId} className="rounded-lg border-2 border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-black text-foreground">{subject?.name ?? subjectId}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-extrabold text-muted-foreground">
                            {formatCurrency(Number(fee))}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveSubject(subjectId, subject?.name ?? subjectId)}
                            className="rounded-lg border-2 border-destructive/40 p-1.5 text-destructive hover:border-destructive"
                            aria-label="إزالة المادة"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      </div>
                      {group ? (
                        <p className="mt-1.5 text-xs font-bold text-muted-foreground">
                          مجموعة {group.name} · مدرس: {group.teacher_name} ·{" "}
                          {group.scheduling_status === "scheduled" ? `${group.weekday} ${group.time}` : "بانتظار الجدولة"}
                        </p>
                      ) : (
                        <p className="mt-1.5 text-xs font-bold text-warning">غير مربوطة بمجموعة بعد</p>
                      )}
                      {group && alternativeGroups.length > 0 ? (
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            changeGroupForSubject(group.id, e.target.value);
                            e.currentTarget.value = "";
                          }}
                          className="mt-2 w-full rounded-lg border-2 border-border bg-background px-2 py-1.5 text-xs font-bold outline-none focus:border-primary"
                        >
                          <option value="">نقل لمجموعة أخرى لنفس المادة…</option>
                          {alternativeGroups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name} · {g.teacher_name} · {g.weekday} {g.time} ({getEnrolledCount(state, g.id)}/{g.capacity})
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* الاشتراكات والماليات */}
          <section className="rounded-xl border-2 border-border p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-black text-foreground">
              <Banknote className="size-4 text-primary" /> الاشتراكات والماليات
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniStat label="إجمالي الرسوم الحالية" value={formatCurrency(
                Object.values(student.subject_fees ?? {}).reduce((s, v) => s + (Number(v) || 0), 0),
              )} />
              <MiniStat label="إجمالي المدفوع" value={formatCurrency(totalPaid)} tone="success" />
              <MiniStat
                label="المستحق المتبقي"
                value={formatCurrency(student.balance_due)}
                tone={student.balance_due > 0 ? "warning" : "success"}
              />
              <MiniStat label="عدد عمليات الدفع" value={formatNumber(studentPayments.length)} />
            </div>
            <div className="mt-3">
              {studentPayments.length === 0 ? (
                <p className="text-sm font-bold text-muted-foreground">لا توجد مدفوعات مسجّلة.</p>
              ) : (
                <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
                  {studentPayments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 text-sm font-bold text-foreground">
                      <span className="truncate">{p.item} · {formatDateTime(p.created_at)}</span>
                      <span className="shrink-0 text-success">{formatCurrency(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* الحضور والمتابعة */}
          <section className="grid gap-4 sm:grid-cols-2">
            <SubPanel title="سجل الحضور" icon={CalendarCheck}>
              <p className="mb-2 text-xs font-bold text-muted-foreground">
                نسبة الحضور: {formatPercent(student.attendance_rate)}
              </p>
              {studentAttendance.length === 0 ? (
                <p className="text-sm font-bold text-muted-foreground">لا توجد سجلات حضور.</p>
              ) : (
                <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
                  {studentAttendance.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 text-sm font-bold text-foreground">
                      <span>{a.checked_in_at}</span>
                      <StatusBadge tone={a.status === "present" ? "success" : a.status === "late" ? "warning" : "destructive"}>
                        {a.status === "present" ? "حاضر" : a.status === "late" ? "متأخر" : "غائب"}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
            </SubPanel>

            <SubPanel title="الواجبات" icon={BookOpen}>
              <p className="mb-2 text-xs font-bold text-muted-foreground">
                {formatNumber(totalHomeworkPending)} واجب لم يُسلَّم بعد
              </p>
              {studentHomework.length === 0 ? (
                <p className="text-sm font-bold text-muted-foreground">لا توجد واجبات.</p>
              ) : (
                <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
                  {studentHomework.map((h) => (
                    <li key={h.id} className="flex items-center justify-between gap-2 text-sm font-bold text-foreground">
                      <span className="truncate">{h.title}</span>
                      <StatusBadge
                        tone={h.status === "graded" ? "success" : h.status === "submitted" ? "primary" : h.status === "late" ? "destructive" : "warning"}
                      >
                        {h.status === "pending" ? "لم يُسلَّم" : h.status === "submitted" ? "تم التسليم" : h.status === "graded" ? `مُصحَّح (${h.grade ?? "—"})` : "متأخر"}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
            </SubPanel>
          </section>

          <section className="rounded-xl border-2 border-border p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-black text-foreground">
              <GraduationCap className="size-4 text-primary" /> ملاحظات المدرسين
            </p>
            {studentNotes.length === 0 ? (
              <p className="text-sm font-bold text-muted-foreground">لا توجد ملاحظات.</p>
            ) : (
              <ul className="mb-3 max-h-32 space-y-1 overflow-y-auto pr-1">
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
            <div className="flex items-end gap-2">
              <input
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="اكتب ملاحظة قصيرة"
                className="flex-1 rounded-lg border-2 border-border bg-background px-3 py-2 text-sm font-bold outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => {
                  if (!noteDraft.trim()) {
                    toast.error("اكتب نص الملاحظة أولاً");
                    return;
                  }
                  const g = groups.find((gr) => gr.id === student.group_id);
                  if (!g?.teacher_id) {
                    toast.error("الطالب غير مسجّل في مجموعة لها مدرس بعد");
                    return;
                  }
                  addTeacherNote(student.id, g.teacher_id, noteDraft);
                  setNoteDraft("");
                  toast.success("تم حفظ الملاحظة");
                }}
                className="rounded-lg border-2 border-primary bg-primary/10 px-3 py-2 text-xs font-black text-primary"
              >
                حفظ
              </button>
            </div>
          </section>

          {/* منطقة الخطر */}
          <section className="rounded-xl border-2 border-destructive/40 bg-destructive/5 p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-black text-destructive">
              <AlertTriangle className="size-4" /> منطقة الخطر
            </p>
            <p className="mb-3 text-xs font-bold text-muted-foreground">
              حذف جذري ونهائي للطالب من النظام — حضوره وواجباته وتقييماته ستُحذف بالكامل. مدفوعاته
              المالية السابقة تفضل محفوظة كأرشيف محاسبي ولا تُحذف.
            </p>
            {!confirmingDelete ? (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="flex items-center gap-2 rounded-lg border-2 border-destructive bg-destructive/10 px-3 py-2 text-sm font-black text-destructive"
              >
                <Trash2 className="size-4" /> حذف الطالب نهائياً
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-black text-foreground">
                  اكتب اسم الطالب بالكامل («{student.full_name}») للتأكيد:
                </p>
                <input
                  value={deleteNameInput}
                  onChange={(e) => setDeleteNameInput(e.target.value)}
                  className="w-full rounded-lg border-2 border-destructive/40 bg-background px-3 py-2 text-sm font-bold outline-none focus:border-destructive"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={deleteNameInput.trim() !== student.full_name.trim() || busy}
                    onClick={() => setShowPasswordConfirm(true)}
                    className="rounded-lg bg-destructive px-3 py-2 text-xs font-black text-destructive-foreground transition-opacity disabled:opacity-40"
                  >
                    تأكيد الحذف — أدخل كلمة السر
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingDelete(false);
                      setDeleteNameInput("");
                    }}
                    className="rounded-lg border-2 border-border px-3 py-2 text-xs font-black text-foreground"
                  >
                    إلغاء
                  </button>
                </div>
                {busy ? (
                  <p className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> جارٍ الحذف…
                  </p>
                ) : null}
                <OwnerPasswordConfirmModal
                  open={showPasswordConfirm}
                  title="تأكيد الحذف النهائي"
                  description={`سيتم حذف ${student.full_name} نهائياً من النظام. لا يمكن التراجع عن هذه العملية.`}
                  confirmLabel="حذف نهائي"
                  destructive
                  onClose={() => setShowPasswordConfirm(false)}
                  onConfirm={runDelete}
                />
              </div>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MiniStat({
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
        "rounded-lg border-2 p-2.5",
        tone === "success" && "border-success/40 bg-success/5",
        tone === "warning" && "border-warning/40 bg-warning/5",
        tone === "destructive" && "border-destructive/40 bg-destructive/5",
        !tone && "border-border",
      )}
    >
      <p className="text-[11px] font-bold text-muted-foreground">{label}</p>
      <p className="kpi-number text-base">{value}</p>
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

