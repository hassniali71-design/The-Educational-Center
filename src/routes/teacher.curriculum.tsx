import { createFileRoute, Navigate } from "@tanstack/react-router";
import {
  BookOpen,
  Check,
  ClipboardList,
  Clock,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Panel, StatCard } from "@/components/dashboard/StatCard";
import { AppShell } from "@/components/layout/AppShell";
import { GroupCurriculumTimeline } from "@/components/teacher/GroupCurriculumTimeline";
import { GroupResourcesPanel } from "@/components/teacher/GroupResourcesPanel";
import { useCurrentTeacher } from "@/hooks/use-current-teacher";
import {
  createLessonPlan,
  deleteLessonPlan,
  getGroupsForTeacher,
  getLessonPlansForTeacher,
  markLessonPlanState,
  updateLessonPlan,
  useDataStore,
  useIsHydrated,
} from "@/lib/data-store";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Group, LessonPlan } from "@/types";

export const Route = createFileRoute("/teacher/curriculum")({
  head: () => ({
    meta: [
      { title: "الخطة والمنهج — المدرس" },
      {
        name: "description",
        content: "خطط الدروس لكل مجموعة — يفصلها المدرس بنفسه عن المهام الإدارية.",
      },
    ],
  }),
  component: CurriculumPage,
});

const ALL_GROUPS = "all" as const;

function CurriculumPage() {
  const state = useDataStore();
  const isHydrated = useIsHydrated();
  const teacher = useCurrentTeacher();
  useEffect(() => {
    if (isHydrated && !teacher) toast.error("الجلسة منتهية — سجّل الدخول من جديد");
  }, [teacher, isHydrated]);

  // كل الـ hooks لازم تُستدعى بنفس الترتيب في كل render — قبل أي early return
  // (isHydrated/teacher بيتغيّروا بمرور الوقت، فلو الـ hooks كانت بعد الـ return
  // كان عددها هيختلف بين render وتاني وده بيكسر React Hooks rules فعلياً).
  const myGroups = teacher ? getGroupsForTeacher(state, teacher.id) : [];
  const myPlans = teacher ? getLessonPlansForTeacher(state, teacher.id) : [];

  /**
   * الفلتر الأساسي بقى الصف الدراسي، مش المجموعة مباشرة — طلب صريح: مدرس
   * بيدرّس نفس الصف في مجموعتين (مثلاً الأحد والأربعاء) لازم يشوف صفه كوحدة
   * واحدة أولاً، مع إمكانية المقارنة بين المجموعتين لو احتاج. `LessonPlan`
   * نفسها مرتبطة بمجموعة محددة (كل مجموعة ممكن يكون معاها خطة مختلفة فعلياً)،
   * فمفيش دمج قسري لمحتوى الخطط — بس العرض والتجميع بقى بالصف أولاً.
   */
  const grades = useMemo(
    () =>
      Array.from(
        new Set(
          myGroups
            .map((g) => g.grade)
            .filter((x): x is string => typeof x === "string" && x.trim().length > 0),
        ),
      ),
    [myGroups],
  );
  const [gradeFilter, setGradeFilter] = useState<string | typeof ALL_GROUPS>(ALL_GROUPS);
  const [groupFilter, setGroupFilter] = useState<string | typeof ALL_GROUPS>(ALL_GROUPS);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddFor, setShowAddFor] = useState<string | null>(null);

  const gradeGroups =
    gradeFilter === ALL_GROUPS ? myGroups : myGroups.filter((g) => g.grade === gradeFilter);
  const filteredGroups =
    groupFilter === ALL_GROUPS ? gradeGroups : gradeGroups.filter((g) => g.id === groupFilter);
  const filteredPlans = useMemo(() => {
    const groupIds = new Set(filteredGroups.map((g) => g.id));
    return myPlans.filter((p) => groupIds.has(p.group_id));
  }, [myPlans, filteredGroups]);

  const plansByGroup = useMemo(() => {
    const map = new Map<string, LessonPlan[]>();
    for (const p of myPlans) {
      const arr = map.get(p.group_id) ?? [];
      arr.push(p);
      map.set(p.group_id, arr);
    }
    return map;
  }, [myPlans]);

  if (!isHydrated) return null;
  if (!teacher) return <Navigate to="/login" />;

  const totalPrepared = filteredPlans.filter((p) => p.prepared_done).length;
  const totalTaught = filteredPlans.filter((p) => p.taught_done).length;
  const totalPending = filteredPlans.length - totalTaught;
  const prepRate = filteredPlans.length
    ? Math.round((totalPrepared / filteredPlans.length) * 100)
    : 0;

  // مقياس "التحضير المسبق": خطط أُعدّت قبل 24 ساعة من الآن (proxy بسيط)
  const preparedAhead = filteredPlans.filter((p) => {
    if (!p.prepared_at || !p.created_at) return false;
    const prep = Date.parse(p.prepared_at);
    const created = Date.parse(p.created_at);
    return prep - created >= 0;
  }).length;
  const aheadRate = filteredPlans.length
    ? Math.round((preparedAhead / filteredPlans.length) * 100)
    : 0;

  return (
    <AppShell
      role="teacher"
      title="الخطة والمنهج"
      description="خطط الدروس التي تعدّها أنت لكل مجموعة — منفصلة عن مهام الإدارة"
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="إجمالي الخطط"
          value={formatNumber(filteredPlans.length)}
          icon={ClipboardList}
        />
        <StatCard
          label="تم الإعداد"
          value={formatNumber(totalPrepared)}
          icon={Check}
          tone="primary"
        />
        <StatCard
          label="تم التدريس"
          value={formatNumber(totalTaught)}
          icon={BookOpen}
          tone="success"
        />
        <StatCard
          label="معلّق (لم يُدرَّس)"
          value={formatNumber(totalPending)}
          icon={Clock}
          tone="warning"
        />
      </div>

      <Panel
        title="مؤشر التحضير المسبق"
        description="نسبة الخطط التي أعدّيتها قبل الموعد — يساعدك تعرف هل بتجهّز بدري ولا متأخر"
      >
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="h-3 overflow-hidden rounded-full border-2 border-border bg-muted">
              <div
                className={cn(
                  "h-full transition-all",
                  aheadRate >= 80
                    ? "bg-success"
                    : aheadRate >= 50
                      ? "bg-warning"
                      : "bg-destructive",
                )}
                style={{ width: `${aheadRate}%` }}
              />
            </div>
          </div>
          <span className="font-black text-foreground">{formatPercent(aheadRate)}</span>
        </div>
        <p className="mt-2 text-xs font-bold text-muted-foreground">
          {formatNumber(preparedAhead)} من {formatNumber(filteredPlans.length)} خطة تم إعدادها قبل
          الموعد المخطط.
        </p>
        {prepRate < 50 && filteredPlans.length > 0 ? (
          <p className="mt-3 rounded-xl border-2 border-warning/40 bg-warning/10 p-3 text-xs font-black text-warning">
            ⚠️ تحضيرك المسبق أقل من 50٪ — حاول تجهّز الخطة قبل 24 ساعة من الحصة.
          </p>
        ) : null}
      </Panel>

      <Panel
        title="الفلتر والبحث"
        description="اختر الصف الدراسي أولاً (تجميع كل مجموعاته)، ثم مجموعة مُحدَّدة للمقارنة إن احتجت"
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <FilterPill
              active={gradeFilter === ALL_GROUPS}
              onClick={() => {
                setGradeFilter(ALL_GROUPS);
                setGroupFilter(ALL_GROUPS);
              }}
            >
              كل الصفوف
            </FilterPill>
            {grades.map((grade) => (
              <FilterPill
                key={grade}
                active={gradeFilter === grade}
                onClick={() => {
                  setGradeFilter(grade);
                  setGroupFilter(ALL_GROUPS);
                }}
              >
                {grade}
              </FilterPill>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterPill
              active={groupFilter === ALL_GROUPS}
              onClick={() => setGroupFilter(ALL_GROUPS)}
            >
              كل المجموعات
            </FilterPill>
            {gradeGroups.map((g) => (
              <FilterPill
                key={g.id}
                active={groupFilter === g.id}
                onClick={() => setGroupFilter(g.id)}
              >
                {g.name} · {g.grade}
              </FilterPill>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث باسم الدرس أو الوحدة..."
              className="w-full rounded-xl border-2 border-border bg-background py-2 pe-3 ps-9 text-sm font-bold outline-none focus:border-primary"
            />
          </div>
        </div>
      </Panel>

      {filteredGroups.length === 0 ? (
        <Panel title="لا توجد مجموعات">
          <p className="py-8 text-center font-black text-muted-foreground">
            لا توجد مجموعات مرتبطة بك بعد. أضِف مجموعة من "جدول المواعيد" أولاً.
          </p>
        </Panel>
      ) : (
        <div className="space-y-4">
          {filteredGroups.map((g) => {
            const groupPlans = (plansByGroup.get(g.id) ?? []).filter((p) => {
              if (!search.trim()) return true;
              const q = search.trim().toLowerCase();
              return (
                p.lesson_name.toLowerCase().includes(q) ||
                (p.unit ?? "").toLowerCase().includes(q) ||
                (p.notes ?? "").toLowerCase().includes(q)
              );
            });
            return (
              <GroupPlanSection
                key={g.id}
                group={g}
                plans={groupPlans}
                onAdd={() => setShowAddFor(g.id)}
                onEdit={(p) => setEditingId(p.id)}
                onDelete={(p) => {
                  if (confirm(`حذف خطة "${p.lesson_name}"؟`)) {
                    deleteLessonPlan(p.id);
                    toast.success("تم الحذف");
                  }
                }}
                onTogglePrep={(p) => markLessonPlanState(p.id, "prepared", !p.prepared_done)}
                onToggleTaught={(p) => markLessonPlanState(p.id, "taught", !p.taught_done)}
              />
            );
          })}
        </div>
      )}

      {/* Migration 0023 (المرحلة A) — موارد المنهج + Timeline لكل مجموعة */}
      {filteredGroups.length > 0 ? (
        <Panel
          title="موارد المنهج والإطلاقات"
          description="روابط شرح المدرس + كل واجباته وأنشطته — مرتّبة بالأحدث. كل ما يحفظه المدرس في صفحة الحصة يظهر هنا."
        >
          <div className="space-y-6">
            {filteredGroups.map((g) => (
              <div key={`res-${g.id}`} className="space-y-3">
                <h3 className="text-base font-black text-foreground">
                  {g.name} · {g.grade} · {g.weekday} {g.time}
                </h3>
                <GroupResourcesPanel
                  groupId={g.id}
                  teacherId={teacher.id}
                  variant="curriculum"
                />
                <GroupCurriculumTimeline groupId={g.id} />
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {showAddFor ? (
        <AddPlanModal
          groupId={showAddFor}
          onClose={() => setShowAddFor(null)}
          onCreate={(input) => {
            createLessonPlan({ ...input, teacherId: teacher.id, groupId: showAddFor });
            setShowAddFor(null);
            toast.success("تم إضافة خطة الدرس");
          }}
        />
      ) : null}

      {editingId ? (
        <EditPlanModal
          plan={myPlans.find((p) => p.id === editingId)!}
          onClose={() => setEditingId(null)}
          onSave={(patch) => {
            updateLessonPlan(editingId, patch);
            setEditingId(null);
            toast.success("تم الحفظ");
          }}
        />
      ) : null}
    </AppShell>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border-2 px-3 py-2 text-xs font-black transition-colors",
        active
          ? "border-navy bg-navy text-navy-foreground"
          : "border-border bg-background text-foreground hover:border-primary",
      )}
    >
      {children}
    </button>
  );
}

function GroupPlanSection({
  group,
  plans,
  onAdd,
  onEdit,
  onDelete,
  onTogglePrep,
  onToggleTaught,
}: {
  group: Group;
  plans: LessonPlan[];
  onAdd: () => void;
  onEdit: (p: LessonPlan) => void;
  onDelete: (p: LessonPlan) => void;
  onTogglePrep: (p: LessonPlan) => void;
  onToggleTaught: (p: LessonPlan) => void;
}) {
  return (
    <Panel
      title={`${group.name} · ${group.grade}`}
      description={`${group.weekday} ${group.time} · قاعة ${group.room} · ${formatNumber(plans.length)} خطة`}
      actions={
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-2 rounded-xl bg-navy px-4 py-2 text-xs font-black text-navy-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" /> خطة جديدة
        </button>
      }
    >
      {plans.length === 0 ? (
        <p className="rounded-xl border-2 border-dashed border-border p-6 text-center text-sm font-bold text-muted-foreground">
          لا توجد خطط لهذه المجموعة بعد. اضغط "خطة جديدة" لإضافة أول خطة.
        </p>
      ) : (
        <div className="space-y-2">
          {plans.map((p) => (
            <div
              key={p.id}
              className={cn(
                "rounded-xl border-2 p-3",
                p.taught_done
                  ? "border-success/30 bg-success/5"
                  : p.prepared_done
                    ? "border-primary/30 bg-primary/5"
                    : "border-border bg-background",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-base font-black text-foreground">{p.lesson_name}</p>
                  {p.unit ? (
                    <p className="text-xs font-bold text-muted-foreground">الوحدة: {p.unit}</p>
                  ) : null}
                  {p.notes ? (
                    <p className="mt-1 text-xs font-bold text-muted-foreground">📝 {p.notes}</p>
                  ) : null}
                  <p className="mt-1 text-[11px] font-bold text-muted-foreground">
                    أُنشئت {formatDateTime(p.created_at)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <ToggleChip
                    label="تم الإعداد"
                    done={p.prepared_done}
                    onClick={() => onTogglePrep(p)}
                    tone="primary"
                  />
                  <ToggleChip
                    label="تم التدريس"
                    done={p.taught_done}
                    onClick={() => onToggleTaught(p)}
                    tone="success"
                  />
                  <button
                    type="button"
                    onClick={() => onEdit(p)}
                    className="rounded-lg border-2 border-border p-1.5 text-foreground hover:border-primary"
                    aria-label="تعديل"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(p)}
                    className="rounded-lg border-2 border-destructive/30 p-1.5 text-destructive hover:bg-destructive/10"
                    aria-label="حذف"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ToggleChip({
  label,
  done,
  onClick,
  tone,
}: {
  label: string;
  done: boolean;
  onClick: () => void;
  tone: "primary" | "success";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-lg border-2 px-2 py-1 text-[11px] font-black transition-colors",
        done
          ? tone === "primary"
            ? "border-primary bg-primary/15 text-primary"
            : "border-success bg-success/15 text-success"
          : "border-border text-muted-foreground hover:border-foreground",
      )}
    >
      {done ? <Check className="size-3" /> : <X className="size-3" />}
      {label}
    </button>
  );
}

function AddPlanModal({
  groupId,
  onClose,
  onCreate,
}: {
  groupId: string;
  onClose: () => void;
  onCreate: (input: { lessonName: string; unit?: string; notes?: string }) => void;
}) {
  const [lessonName, setLessonName] = useState("");
  const [unit, setUnit] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <ModalShell title="خطة درس جديدة" onClose={onClose}>
      <div className="space-y-3">
        <Field label="اسم الدرس" required>
          <input
            value={lessonName}
            onChange={(e) => setLessonName(e.target.value)}
            maxLength={60}
            placeholder="مثال: المعادلات من الدرجة الثانية"
            className="w-full rounded-xl border-2 border-border bg-background px-3 py-2 text-sm font-bold text-foreground outline-none focus:border-primary"
          />
          <p className="mt-1 text-[11px] font-bold text-muted-foreground">{lessonName.length}/60</p>
        </Field>
        <Field label="الوحدة">
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="مثال: الوحدة الثالثة — الجبر"
            className="w-full rounded-xl border-2 border-border bg-background px-3 py-2 text-sm font-bold text-foreground outline-none focus:border-primary"
          />
        </Field>
        <Field label="ملاحظات مختصرة">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={200}
            rows={2}
            placeholder="نقاط سريعة للتذكير قبل الحصة..."
            className="w-full rounded-xl border-2 border-border bg-background px-3 py-2 text-sm font-bold text-foreground outline-none focus:border-primary"
          />
        </Field>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border-2 border-border px-4 py-2 text-sm font-black text-foreground hover:bg-muted"
          >
            إلغاء
          </button>
          <button
            type="button"
            disabled={!lessonName.trim()}
            onClick={() => {
              const v = unit.trim();
              const n = notes.trim();
              onCreate({
                lessonName: lessonName.trim(),
                ...(v ? { unit: v } : {}),
                ...(n ? { notes: n } : {}),
              });
            }}
            className="flex items-center gap-2 rounded-xl bg-navy px-5 py-2 text-sm font-black text-navy-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Plus className="size-4" /> إضافة
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function EditPlanModal({
  plan,
  onClose,
  onSave,
}: {
  plan: LessonPlan;
  onClose: () => void;
  onSave: (patch: { lessonName?: string; unit?: string | null; notes?: string | null }) => void;
}) {
  const [lessonName, setLessonName] = useState(plan.lesson_name);
  const [unit, setUnit] = useState(plan.unit ?? "");
  const [notes, setNotes] = useState(plan.notes ?? "");

  return (
    <ModalShell title="تعديل خطة الدرس" onClose={onClose}>
      <div className="space-y-3">
        <Field label="اسم الدرس" required>
          <input
            value={lessonName}
            onChange={(e) => setLessonName(e.target.value)}
            maxLength={60}
            className="w-full rounded-xl border-2 border-border bg-background px-3 py-2 text-sm font-bold text-foreground outline-none focus:border-primary"
          />
        </Field>
        <Field label="الوحدة">
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="w-full rounded-xl border-2 border-border bg-background px-3 py-2 text-sm font-bold text-foreground outline-none focus:border-primary"
          />
        </Field>
        <Field label="ملاحظات">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={200}
            rows={2}
            className="w-full rounded-xl border-2 border-border bg-background px-3 py-2 text-sm font-bold text-foreground outline-none focus:border-primary"
          />
        </Field>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border-2 border-border px-4 py-2 text-sm font-black text-foreground hover:bg-muted"
          >
            إلغاء
          </button>
          <button
            type="button"
            disabled={!lessonName.trim()}
            onClick={() =>
              onSave({
                lessonName: lessonName.trim(),
                unit: unit.trim() || null,
                notes: notes.trim() || null,
              })
            }
            className="rounded-xl bg-navy px-5 py-2 text-sm font-black text-navy-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            حفظ
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-black text-muted-foreground">
        {label} {required ? <span className="text-destructive">*</span> : null}
      </label>
      {children}
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border-2 border-border bg-background p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black text-foreground">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
            aria-label="إغلاق"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
