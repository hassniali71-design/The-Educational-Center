import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Banknote, CreditCard, Download, Plus, Receipt, Search, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { Panel, StatCard, StatusBadge } from "@/components/dashboard/StatCard";
import { AppShell } from "@/components/layout/AppShell";
import { formatCurrency, formatNumber } from "@/lib/format";
import { recordPayment, sumSubjectFees, useDataStore } from "@/lib/data-store";
import { cn } from "@/lib/utils";
import type { PaymentMethod, Student } from "@/types";

export const Route = createFileRoute("/staff/cashier")({
  head: () => ({
    meta: [
      { title: "شباك الكاشير — السكرتارية" },
      {
        name: "description",
        content: "تحصيل اشتراكات الطلاب بخمسة وسائل دفع وإيصال فوري وإشعار واتساب.",
      },
    ],
  }),
  component: CashierPage,
});

const METHODS: { key: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { key: "cash", label: "كاش", icon: Banknote },
  { key: "wallet", label: "محفظة", icon: Smartphone },
];

/** §2.4 — when wallet is chosen, capture WHICH digital rail the parent paid through
 * (so the owner can still audit). Persists the rail in the reference field. */
const WALLET_RAILS: { key: string; label: string }[] = [
  { key: "تحويل بنكي", label: "تحويل بنكي" },
  { key: "إنستاباي", label: "إنستاباي" },
  { key: "فودافون كاش", label: "فودافون كاش" },
];

const METHOD_LABELS: Record<PaymentMethod, string> = METHODS.reduce(
  (acc, m) => {
    acc[m.key] = m.label;
    return acc;
  },
  {} as Record<PaymentMethod, string>,
);

const planLabels: Record<string, string> = {
  per_session: "حصة",
  monthly: "شهر",
  season: "موسم",
  both: "شهر + حصة",
};

function isToday(iso: string): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.startsWith("اليوم");
  const d = new Date(t);
  const r = new Date();
  return (
    d.getFullYear() === r.getFullYear() &&
    d.getMonth() === r.getMonth() &&
    d.getDate() === r.getDate()
  );
}

function CashierPage() {
  const state = useDataStore();
  const { students, payments: records, booklets, subjects } = state;

  const [query, setQuery] = useState("");
  const [studentId, setStudentId] = useState<string>("");
  const [item, setItem] = useState("");
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  // كانا متغير واحد قديماً (reference) بيتشارك بين "قناة المحفظة" و"الرقم المرجعي"،
  // فاختيار قناة كان بيمسح الرقم المكتوب والعكس. دلوقتي منفصلين ويتجمعوا وقت الحفظ.
  const [walletRail, setWalletRail] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) => s.full_name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q),
    );
  }, [students, query]);

  const todayRecords = records.filter((r) => isToday(r.created_at));
  const todayTotal = todayRecords.reduce((s, r) => s + r.amount, 0);
  const todayCount = todayRecords.length;
  const todayAvg = todayCount > 0 ? todayTotal / todayCount : 0;

  const [filterMonth, setFilterMonth] = useState("");
  const [filterDay, setFilterDay] = useState("");
  const [receiptQuery, setReceiptQuery] = useState("");

  const months = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => {
      const t = Date.parse(r.created_at);
      if (!Number.isNaN(t)) {
        const d = new Date(t);
        set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
    });
    return Array.from(set).sort().reverse();
  }, [records]);

  const days = useMemo(() => {
    if (!filterMonth) return [] as string[];
    const set = new Set<string>();
    records.forEach((r) => {
      const t = Date.parse(r.created_at);
      if (Number.isNaN(t)) return;
      const d = new Date(t);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (k === filterMonth) set.add(String(d.getDate()));
    });
    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }, [records, filterMonth]);

  const student = students.find((s) => s.id === studentId);

  const subjectLines = (s: Student) =>
    s.subject_ids.map((id) => ({
      id,
      name: subjects.find((sub) => sub.id === id)?.name ?? id,
      price: Number(s.subject_fees?.[id] ?? 0),
    }));

  const pick = (s: Student, label: string, value: number) => {
    setStudentId(s.id);
    setItem(label);
    setAmount(value);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!student) {
      toast.error("اختر طالباً من القائمة أولاً");
      return;
    }
    if (!item.trim()) {
      toast.error("اختر البند الذي يتم تحصيله");
      return;
    }
    if (!amount || amount <= 0) {
      toast.error("أدخل مبلغاً صحيحاً");
      return;
    }
    if (method !== "cash" && (!walletRail || !referenceNumber.trim())) {
      toast.error("اختر قناة المحفظة واكتب الرقم المرجعي");
      return;
    }
    const reference =
      method === "cash" ? null : `${walletRail} - ${referenceNumber.trim()}`;
    recordPayment(student.code, amount, method, item.trim(), reference);
    toast.success("تم التحصيل وطباعة الإيصال", {
      description: `${student.full_name} · ${formatCurrency(amount)}`,
    });
    setWalletRail("");
    setReferenceNumber("");
  };

  const exportCsv = () => {
    const rows = records
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const header = ["اسم الطالب", "الكود", "المبلغ", "الوسيلة", "البند", "التاريخ"];
    const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const csv = [header, ...rows.map((r) => [
      r.student_name,
      r.student_code,
      String(r.amount),
      METHOD_LABELS[r.method] ?? r.method,
      r.item,
      r.created_at,
    ])]
      .map((line) => line.map(escape).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تصدير الإيصالات كملف CSV");
  };

  const visibleReceipts = records
    .filter((r) => {
      if (filterMonth) {
        const t = Date.parse(r.created_at);
        if (!Number.isNaN(t)) {
          const d = new Date(t);
          const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          if (k !== filterMonth) return false;
        }
      }
      if (filterDay) {
        const t = Date.parse(r.created_at);
        if (!Number.isNaN(t)) {
          if (String(new Date(t).getDate()) !== filterDay) return false;
        }
      }
      if (receiptQuery.trim()) {
        const q = receiptQuery.trim().toLowerCase();
        if (
          !r.student_name.toLowerCase().includes(q) &&
          !r.student_code.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return (
    <AppShell
      role="staff"
      title="شباك الكاشير"
      description="تحصيل حسب كل مادة مع إيصال فوري وإشعار واتساب"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="إجمالي تحصيل اليوم" value={formatCurrency(todayTotal)} icon={Banknote} tone="success" />
        <StatCard label="متوسط قيمة العملية" value={formatCurrency(todayAvg)} icon={Receipt} />
        <StatCard label="عدد عمليات اليوم" value={formatNumber(todayCount)} icon={Receipt} />
      </div>

      <Panel
        title="شبكة التحصيل — كل الطلاب"
        description="اضغط على أي مادة لتحصيل قيمتها من الطالب مباشرة"
      >
        <div className="mb-4 flex items-center gap-2 rounded-xl border-2 border-border px-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث باسم الطالب أو كوده"
            className="h-12 w-full bg-transparent text-sm font-black outline-none"
          />
        </div>

        {students.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-border p-6 text-center text-sm font-black text-muted-foreground">
            لا توجد بيانات بعد — أضف طلاباً من صفحة المالك (إدارة الوصول) وسيظهرون هنا فوراً.
          </p>
        ) : (
          <div className="space-y-3">
            {filtered.map((s) => {
              const lines = subjectLines(s);
              const expected = sumSubjectFees(s.subject_fees);
              return (
                <div
                  key={s.id}
                  className={cn(
                    "rounded-xl border-2 p-4",
                    studentId === s.id ? "border-primary bg-primary/5" : "border-border",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-black text-foreground">{s.full_name}</p>
                      <p className="text-xs font-bold text-muted-foreground">
                        {s.code} · {s.grade} · نوع الحساب:{" "}
                        {planLabels[s.billing_plan ?? "monthly"] ?? "شهر"}
                      </p>
                    </div>
                    <StatusBadge tone={s.balance_due > 0 ? "warning" : "success"}>
                      {s.balance_due > 0
                        ? `مستحق ${formatCurrency(s.balance_due)}`
                        : "لا توجد مستحقات"}
                    </StatusBadge>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {lines.length === 0 ? (
                      <span className="text-xs font-bold text-muted-foreground">
                        لا توجد مواد مسجّلة لهذا الطالب.
                      </span>
                    ) : (
                      lines.map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => pick(s, `${l.name} — ${s.grade}`, l.price)}
                          className="rounded-xl border-2 border-border px-3 py-2 text-xs font-black text-foreground hover:border-primary"
                        >
                          {l.name} · {formatCurrency(l.price)}
                        </button>
                      ))
                    )}
                  </div>
                  {expected > 0 ? (
                    <p className="mt-2 text-xs font-bold text-muted-foreground">
                      إجمالي رسوم المواد: {formatCurrency(expected)}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Panel title="عملية تحصيل جديدة" description="الطالب المختار من الشبكة أعلاه">
          <form onSubmit={submit} className="space-y-4">
            <Field label="الطالب">
              {student ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-border p-3">
                  <span className="font-black text-foreground">{student.full_name}</span>
                  <span className="font-mono text-sm font-black text-muted-foreground">
                    {student.code}
                  </span>
                  <StatusBadge tone={student.balance_due > 0 ? "warning" : "success"}>
                    {student.balance_due > 0
                      ? `مستحق ${formatCurrency(student.balance_due)}`
                      : "لا توجد مستحقات"}
                  </StatusBadge>
                </div>
              ) : (
                <p className="text-sm font-black text-muted-foreground">لم يتم اختيار طالب بعد.</p>
              )}
            </Field>

            <Field label="البند">
              <input
                value={item}
                onChange={(e) => setItem(e.target.value)}
                placeholder="اسم المادة أو البند"
                className="h-12 w-full rounded-xl border-2 border-border bg-background px-4 text-sm font-black outline-none focus:border-primary"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {booklets.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      setItem(b.title);
                      setAmount(b.price);
                    }}
                    className="rounded-xl border-2 border-border px-3 py-2 text-xs font-black hover:border-primary"
                  >
                    {b.title} · {formatCurrency(b.price)}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="المبلغ">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="h-14 w-full rounded-xl border-2 border-border bg-background px-4 text-2xl font-black outline-none focus:border-primary"
              />
            </Field>

            <Field label="طريقة الدفع">
              <div className="grid grid-cols-2 gap-2">
                {METHODS.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setMethod(m.key)}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-3 text-sm font-black",
                      method === m.key
                        ? "border-navy bg-navy text-navy-foreground"
                        : "border-border hover:border-primary",
                    )}
                  >
                    <m.icon className="size-4" />
                    {m.label}
                  </button>
                ))}
              </div>
            </Field>

            {method === "wallet" ? (
              <Field label="قناة المحفظة">
                <div className="grid grid-cols-3 gap-2">
                  {WALLET_RAILS.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => setWalletRail(r.key)}
                      className={cn(
                        "rounded-xl border-2 px-3 py-2 text-xs font-black",
                        walletRail === r.key
                          ? "border-navy bg-navy text-navy-foreground"
                          : "border-border hover:border-primary",
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </Field>
            ) : null}

            {method === "wallet" ? (
              <Field label="الرقم المرجعي (مطلوب)">
                <input
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                  placeholder="رقم العملية / المعرف"
                  className="h-12 w-full rounded-xl border-2 border-border bg-background px-4 text-sm font-black outline-none focus:border-primary"
                />
              </Field>
            ) : null}

            <button
              type="submit"
              className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-black text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Plus className="size-5" /> تحصيل وطباعة الإيصال
            </button>
          </form>
        </Panel>

        <Panel
          title="إيصالات الوردية"
          description={`${formatNumber(visibleReceipts.length)} إيصال`}
          actions={
            <button
              type="button"
              onClick={exportCsv}
              className="flex items-center gap-2 rounded-xl border-2 border-border px-3 py-2 text-xs font-black hover:border-primary"
            >
              <Download className="size-4" /> تصدير CSV
            </button>
          }
        >
          <div className="mb-3 grid grid-cols-3 gap-2">
            <input
              value={receiptQuery}
              onChange={(e) => setReceiptQuery(e.target.value)}
              placeholder="بحث"
              className="h-10 rounded-xl border-2 border-border bg-background px-3 text-sm font-black outline-none focus:border-primary"
            />
            <select
              value={filterMonth}
              onChange={(e) => {
                setFilterMonth(e.target.value);
                setFilterDay("");
              }}
              className="h-10 rounded-xl border-2 border-border bg-background px-2 text-sm font-black"
            >
              <option value="">كل الشهور</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <select
              value={filterDay}
              onChange={(e) => setFilterDay(e.target.value)}
              className="h-10 rounded-xl border-2 border-border bg-background px-2 text-sm font-black"
              disabled={!filterMonth}
            >
              <option value="">كل الأيام</option>
              {days.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          {visibleReceipts.length === 0 ? (
            <p className="rounded-xl border-2 border-dashed border-border p-6 text-center text-sm font-black text-muted-foreground">
              لا توجد عمليات تحصيل بعد.
            </p>
          ) : (
            <div className="max-h-[480px] space-y-2 overflow-y-auto">
              {visibleReceipts.map((r) => (
                <div key={r.id} className="rounded-xl border-2 border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-black text-foreground">{r.student_name}</p>
                    <span className="kpi-number text-lg">{formatCurrency(r.amount)}</span>
                  </div>
                  <p className="mt-1 text-xs font-bold text-muted-foreground">
                    {r.item} · {r.student_code} · {r.created_at}
                  </p>
                  <div className="mt-2">
                    <StatusBadge tone="neutral">{METHOD_LABELS[r.method] ?? r.method}</StatusBadge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-sm font-black text-foreground">{label}</p>
      {children}
    </div>
  );
}

