import { AlertCircle, Check, Loader2, UserPlus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { createGroup, getEligibleStudentsForGroup, useDataStore } from "@/lib/data-store";
import { cn } from "@/lib/utils";

interface GroupCreateModalProps {
  open: boolean;
  onClose: () => void;
}

const inputClass =
  "w-full rounded-xl border-2 border-border bg-background px-3 py-2.5 text-base font-bold text-foreground outline-none focus:border-primary";

export function GroupCreateModal({ open, onClose }: GroupCreateModalProps) {
  const state = useDataStore();
  const { grades, subjects, teachers } = state;

  const [name, setName] = useState("");
  const [gradeId, setGradeId] = useState<string>("");
  const [subjectId, setSubjectId] = useState<string>("");
  const [teacherId, setTeacherId] = useState<string>("");
  const [capacity, setCapacity] = useState(20);
  const [notes, setNotes] = useState("");
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const eligibleTeachers = useMemo(() => {
    if (!subjectId) return teachers;
    /**
     * Section 0 fix: migration 0021 made `Teacher.subject_id` nullable for
     * multi-subject teachers. The previous filter dropped them entirely,
     * so a multi-subject teacher could never have a group created. Now
     * include any teacher whose `subject_id` matches OR is null (i.e.
     * teaches all subjects).
     */
    return teachers.filter(
      (t) => t.subject_id === subjectId || t.subject_id === null,
    );
  }, [teachers, subjectId]);

  const eligibleStudents = useMemo(() => {
    if (!gradeId || !subjectId) return [];
    return getEligibleStudentsForGroup(state, gradeId, subjectId);
  }, [state, gradeId, subjectId]);

  const overCapacity = selectedStudents.size > capacity;

  function reset() {
    setName("");
    setGradeId("");
    setSubjectId("");
    setTeacherId("");
    setCapacity(20);
    setNotes("");
    setSelectedStudents(new Set());
  }

  function toggleStudent(id: string) {
    setSelectedStudents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < capacity) next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedStudents((prev) => {
      if (prev.size === eligibleStudents.length) return new Set();
      const next = new Set<string>();
      for (const s of eligibleStudents) {
        if (next.size >= capacity) break;
        next.add(s.id);
      }
      return next;
    });
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error("أدخل اسم المجموعة");
      return;
    }
    if (name.length > 40) {
      toast.error("اسم المجموعة طويل (40 حرف كحد أقصى)");
      return;
    }
    if (!gradeId || !subjectId || !teacherId) {
      toast.error("اختر الصف والمادة والمدرس");
      return;
    }
    if (overCapacity) {
      toast.error("عدد الطلاب المختارين يتجاوز السعة");
      return;
    }
    if (selectedStudents.size === 0) {
      // بدون هذا الشرط، كان ممكن تتعمل مجموعة كاملة (باسم/مادة/مدرس/معاد) من
      // غير أي طالب فيها — تفضل "شبح" تماماً بالنسبة لأي طالب (مش هو ولا مدرّسه
      // ولا معاده هيظهرله في صفحته)، لأن كل شاشات الطالب مبنية على مجموعاته.
      toast.error("اختر طالباً واحداً على الأقل — المجموعة من غير طلاب لن تظهر لأي طالب");
      return;
    }
    setSaving(true);
    try {
      await createGroup({
        name: name.trim(),
        gradeId,
        subjectId,
        teacherId,
        capacity,
        studentIds: [...selectedStudents],
        notes: notes.trim() || undefined,
      });
      toast.success("تم إنشاء المجموعة", {
        description: "يمكنك إضافة ميعاد المجموعة من خلال غرفة التحكم والجدولة.",
      });
      reset();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل إنشاء المجموعة");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="card-crisp max-h-[92vh] w-full max-w-2xl overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UserPlus className="size-5" />
            </span>
            <div>
              <p className="text-lg font-black text-foreground">مجموعة جديدة — الخطوة 1</p>
              <p className="mt-0.5 text-sm font-bold text-muted-foreground">
                أنشئ المجموعة وأضف طلابها. الجدولة تتم لاحقاً من غرفة الجدولة.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
            aria-label="إغلاق"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="اسم المجموعة">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="مثال: عربي - الرابع - مجموعة 1"
              className={inputClass}
            />
          </Field>
          <Field label="السعة القصوى">
            <input
              type="number"
              min={1}
              max={100}
              value={capacity}
              onChange={(e) => setCapacity(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              className={inputClass}
            />
          </Field>
          <Field label="الصف">
            <select
              value={gradeId}
              onChange={(e) => setGradeId(e.target.value)}
              className={inputClass}
            >
              <option value="">اختر الصف</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="المادة">
            <select
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value);
                setTeacherId("");
              }}
              className={inputClass}
            >
              <option value="">اختر المادة</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="المدرس" full>
            <select
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              className={inputClass}
              disabled={!subjectId}
            >
              <option value="">{subjectId ? "اختر المدرس" : "اختر المادة أولاً"}</option>
              {eligibleTeachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ملاحظات (اختياري)" full>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-6 rounded-xl border-2 border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-black text-foreground">الطلاب المؤهلون</p>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded-lg px-2 py-1 text-xs font-black",
                  overCapacity
                    ? "bg-destructive/10 text-destructive"
                    : selectedStudents.size === capacity
                      ? "bg-warning/10 text-warning"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {selectedStudents.size} / {capacity}
              </span>
              {eligibleStudents.length > 0 ? (
                <button
                  type="button"
                  onClick={toggleAll}
                  className="rounded-lg border-2 border-border px-2 py-1 text-xs font-black text-foreground hover:border-primary"
                >
                  {selectedStudents.size === eligibleStudents.length
                    ? "إلغاء تحديد الكل"
                    : "تحديد الكل"}
                </button>
              ) : null}
            </div>
          </div>
          {eligibleStudents.length === 0 ? (
            <p className="mt-3 rounded-lg border-2 border-dashed border-border p-4 text-center text-sm font-bold text-muted-foreground">
              {!gradeId || !subjectId
                ? "اختر الصف والمادة لعرض الطلاب المؤهلين."
                : "لا يوجد طلاب في هذا الصف مسجّلون في هذه المادة."}
            </p>
          ) : (
            <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1">
              {eligibleStudents.map((s) => {
                const checked = selectedStudents.has(s.id);
                const disabled = !checked && selectedStudents.size >= capacity;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => toggleStudent(s.id)}
                      disabled={disabled}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-lg border-2 px-3 py-2 text-right transition-colors",
                        checked
                          ? "border-primary bg-primary/5"
                          : "border-border bg-background hover:border-primary",
                        disabled && "opacity-50",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex size-5 items-center justify-center rounded-md border-2",
                            checked ? "border-primary bg-primary text-primary-foreground" : "border-border",
                          )}
                        >
                          {checked ? <Check className="size-3" /> : null}
                        </span>
                        <div>
                          <p className="text-sm font-black text-foreground">{s.full_name}</p>
                          <p className="text-xs font-bold text-muted-foreground">
                            {s.code} · {s.group_name}
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {overCapacity ? (
            <p className="mt-3 flex items-center gap-2 text-xs font-black text-destructive">
              <AlertCircle className="size-3.5" />
              السعة مكتملة — أضف طالباً لاحقاً بعد زيادة السعة من التعديل.
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border-2 border-border px-4 py-2 text-sm font-black text-foreground hover:border-primary"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || overCapacity}
            className="flex items-center gap-2 rounded-xl bg-navy px-4 py-2 text-sm font-black text-navy-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            إنشاء المجموعة
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={cn("block", full && "sm:col-span-2")}>
      <span className="mb-1.5 block text-sm font-black text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
