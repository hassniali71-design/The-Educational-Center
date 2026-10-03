import { FileText, Link2, Plus, Search, Trash2, Video, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Panel } from "@/components/dashboard/StatCard";
import { addGroupResource, deleteGroupResource, getGroupResourcesForGroup, useDataStore } from "@/lib/data-store";
import { cn } from "@/lib/utils";
import type { GroupResourceType } from "@/types";

/**
 * المرحلة A — كارت "موارد المجموعة" في صفحة الحصة وفي `/teacher/curriculum`.
 * المدرس يحفظ روابط شرح (lesson_url)، PDF، روابط خارجية، فيديو.
 *
 * البحث، السحب الداخلي، الإضافة، الحذف — كل شيء في كارت full-width واحد
 * بحدّ أقصى للتمرير الداخلي (max-h).
 */
export function GroupResourcesPanel({
  groupId,
  teacherId,
  variant = "session",
}: {
  groupId: string;
  /** Teacher.id الحقيقي — يُحفظ في `created_by` (يشاور على teachers(id)، migration 0037). */
  teacherId: string;
  /** "session" = داخل صفحة الحصة (compact) | "curriculum" = صفحة المنهج (أوسع). */
  variant?: "session" | "curriculum";
}) {
  const state = useDataStore();
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const resources = useMemo(() => getGroupResourcesForGroup(state, groupId), [state.groupResources, groupId]);
  const filtered = useMemo(() => {
    if (!search.trim()) return resources;
    const q = search.trim().toLowerCase();
    return resources.filter(
      (r) => r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q) || (r.unit ?? "").toLowerCase().includes(q),
    );
  }, [resources, search]);

  return (
    <Panel
      title="روابط المنهج والمرفقات"
      description="كل ما يحفظه المدرس يظهر للطلاب وفي صفحة المنهج فوراً"
      actions={
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 rounded-xl bg-navy px-4 py-2 text-xs font-black text-navy-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" /> إضافة رابط
        </button>
      }
    >
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو الرابط أو الوحدة..."
            className="w-full rounded-xl border-2 border-border bg-background py-2 pe-3 ps-9 text-sm font-bold outline-none focus:border-primary"
          />
        </div>

        <div className={cn("space-y-2 overflow-y-auto pr-1", variant === "session" ? "max-h-72" : "max-h-[420px]")}>
          {filtered.length === 0 ? (
            <p className="rounded-xl border-2 border-dashed border-border p-6 text-center text-sm font-bold text-muted-foreground">
              {resources.length === 0
                ? "لا توجد موارد بعد. اضغط «إضافة رابط» لحفظ أول رابط شرح أو PDF."
                : "لا توجد نتائج تطابق البحث."}
            </p>
          ) : (
            filtered.map((r) => {
              const Icon = RESOURCE_ICON[r.resource_type];
              return (
                <div
                  key={r.id}
                  className="flex items-start justify-between gap-3 rounded-xl border-2 border-border bg-background p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("flex size-7 items-center justify-center rounded-lg", RESOURCE_TONE[r.resource_type])}>
                        <Icon className="size-3.5" />
                      </span>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="truncate text-sm font-black text-foreground underline decoration-dotted underline-offset-2 hover:text-primary"
                      >
                        {r.name}
                      </a>
                    </div>
                    {r.unit ? (
                      <p className="mt-1 text-xs font-bold text-muted-foreground">الوحدة: {r.unit}</p>
                    ) : null}
                    <p className="mt-1 line-clamp-1 text-[11px] font-bold text-muted-foreground" dir="ltr">
                      {r.url}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`حذف "${r.name}"؟`)) {
                        deleteGroupResource(r.id);
                        toast.success("تم الحذف");
                      }
                    }}
                    className="rounded-lg border-2 border-destructive/30 p-1.5 text-destructive hover:bg-destructive/10"
                    aria-label="حذف"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {showAdd ? (
        <AddResourceModal
          onClose={() => setShowAdd(false)}
          onCreate={(input) => {
            addGroupResource({ ...input, groupId, createdBy: teacherId });
            setShowAdd(false);
            toast.success("تم حفظ الرابط");
          }}
        />
      ) : null}
    </Panel>
  );
}

const RESOURCE_ICON: Record<GroupResourceType, typeof FileText> = {
  lesson_url: Link2,
  pdf: FileText,
  external_link: Link2,
  video: Video,
  other: FileText,
};

const RESOURCE_TONE: Record<GroupResourceType, string> = {
  lesson_url: "bg-primary/10 text-primary",
  pdf: "bg-destructive/10 text-destructive",
  external_link: "bg-info/10 text-info",
  video: "bg-success/10 text-success",
  other: "bg-muted text-muted-foreground",
};

const RESOURCE_LABEL: Record<GroupResourceType, string> = {
  lesson_url: "رابط شرح",
  pdf: "PDF",
  external_link: "رابط خارجي",
  video: "فيديو",
  other: "أخرى",
};

function AddResourceModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: {
    resourceType: GroupResourceType;
    url: string;
    name: string;
    unit?: string | null;
  }) => void;
}) {
  const [resourceType, setResourceType] = useState<GroupResourceType>("lesson_url");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");

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
          <h3 className="text-lg font-black text-foreground">إضافة رابط جديد</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
            aria-label="إغلاق"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-3">
          <Field label="نوع المورد">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(RESOURCE_LABEL) as GroupResourceType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setResourceType(t)}
                  className={cn(
                    "rounded-xl border-2 px-3 py-1.5 text-xs font-black",
                    resourceType === t
                      ? "border-navy bg-navy text-navy-foreground"
                      : "border-border bg-background text-foreground hover:border-primary",
                  )}
                >
                  {RESOURCE_LABEL[t]}
                </button>
              ))}
            </div>
          </Field>
          <Field label="الرابط" required>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              dir="ltr"
              className="w-full rounded-xl border-2 border-border bg-background px-3 py-2 text-sm font-bold text-foreground outline-none focus:border-primary"
            />
          </Field>
          <Field label="اسم المورد" required>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="مثال: شرح الدرس الأول"
              className="w-full rounded-xl border-2 border-border bg-background px-3 py-2 text-sm font-bold text-foreground outline-none focus:border-primary"
            />
          </Field>
          <Field label="الوحدة (اختياري)">
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="مثال: الوحدة الثالثة"
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
              disabled={!url.trim() || !name.trim()}
              onClick={() => {
                const u = unit.trim();
                onCreate({
                  resourceType,
                  url: url.trim(),
                  name: name.trim(),
                  ...(u ? { unit: u } : {}),
                });
              }}
              className="flex items-center gap-2 rounded-xl bg-navy px-5 py-2 text-sm font-black text-navy-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Plus className="size-4" /> حفظ
            </button>
          </div>
        </div>
      </div>
    </div>
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
