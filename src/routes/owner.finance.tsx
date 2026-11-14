import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDownRight,
  Banknote,
  Crown,
  PiggyBank,
  Receipt,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { useMemo } from "react";

import { Panel, StatCard, StatusBadge } from "@/components/dashboard/StatCard";
import { AppShell } from "@/components/layout/AppShell";
import { formatCurrency, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { computeStudentFees, useDataStore } from "@/lib/data-store";
import { buildTeacherFinance, computeOwnerKpis } from "@/lib/owner-metrics";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/finance")({
  head: () => ({
    meta: [
      { title: "التدفق المالي — لوحة المالك" },
      {
        name: "description",
        content: "تحليل التحصيل والمصروفات والرواتب وصافي الربح لكل مدرس من البيانات الحقيقية.",
      },
      { property: "og:title", content: "التدفق المالي — لوحة المالك" },
      {
        property: "og:description",
        content: "أرقام مالية محسوبة من عمليات التحصيل والرواتب والمصروفات الحقيقية داخل السنتر.",
      },
    ],
  }),
  component: FinancePage,
});

const METHOD_LABEL: Record<string, string> = {
  cash: "كاش",
  wallet: "محفظة (كاش/إنستاباي/تحويل)",
  instapay: "إنستاباي",
  legacy: "مرحّلة من الشيت",
};

function FinancePage() {
  const state = useDataStore();
  const { payments, students, subjects } = state;

  const kpis = useMemo(() => computeOwnerKpis(state), [state]);
  const teacherFinance = useMemo(() => buildTeacherFinance(state), [state]);

  const monthlyStudents = students.filter(
    (s) =>
      s.billing_plan === "monthly" ||
      s.billing_plan === "season" ||
      s.billing_plan === "both" ||
      !s.billing_plan,
  ).length;
  const perSessionStudents = students.filter(
    (s) => s.billing_plan === "per_session" || s.billing_plan === "both",
  ).length;

  /** إيراد كل مادة = مجموع تحصيل طلابها الفعلي، والمتوقع من أسعار المواد. */
  const subjectRevenue = useMemo(() => {
    return subjects
      .map((sub) => {
        const enrolled = students.filter((s) => s.subject_ids.includes(sub.id));
        const codes = new Set(enrolled.map((s) => s.code));
        const collected = payments
          .filter((p) => codes.has(p.student_code))
          .reduce((s, p) => s + Number(p.amount), 0);
        // المتوقع = مجموع الأسعار الشخصية لكل طالب في هذه المادة (لا سعر عام ثابت).
        const price = state.subjectPrices.find((p) => p.subject_id === sub.id);
        const expected = enrolled.reduce((sum, s) => {
          const personal = Number(s.subject_fees?.[sub.id] ?? 0);
          return sum + (personal || Number(price?.monthly_price ?? 0));
        }, 0);
        return {
          id: sub.id,
          name: sub.name,
          students: enrolled.length,
          collected,
          expected,
        };
      })
      /**
       * الترتيب بالإيراد المتوقع من الاشتراكات الفعلية (`expected`) أولاً، مش
       * بالمُحصَّل فعلياً (`collected`) — لو أغلب طلاب السنتر لسه ما دفعوش
       * (سيناريو حقيقي شائع أول الشهر)، `collected` بتبقى صفر لكل المواد
       * فيرجع أول عنصر في المصفوفة بالصدفة (كان "عربي" في السنتر الحقيقي، مش
       * لأنها فعلاً الأعلى) — بالظبط البج المُبلَّغ. المطلوب صراحة: احسب من
       * عدد الاشتراكات وأسعارها الحقيقية بغض النظر عن حالة السداد.
       */
      .sort((a, b) => b.expected - a.expected || b.collected - a.collected);
  }, [subjects, students, payments, state.subjectPrices]);

  const topSubject = subjectRevenue[0];
  const grossBefore = kpis.monthRevenue;
  const lastPayment = payments[0];

  /**
   * Section 1.11: collapse instapay into wallet — 2 buckets, not 3.
   * The user's analytics only needs cash vs digital; the "wallet" card
   * now also covers instapay and any bank transfer.
   */
  const byMethod = (() => {
    const cashTotal = payments
      .filter((p) => p.method === "cash")
      .reduce((s, p) => s + Number(p.amount), 0);
    const walletTotal = payments
      .filter((p) => p.method === "wallet" || p.method === "instapay")
      .reduce((s, p) => s + Number(p.amount), 0);
    return [
      { method: "cash", total: cashTotal, count: payments.filter((p) => p.method === "cash").length },
      { method: "wallet", total: walletTotal, count: payments.filter((p) => p.method === "wallet" || p.method === "instapay").length },
    ];
  })();

  return (
    <AppShell
      role="owner"
      title="التدفق المالي"
      description="تحليل آلي كامل: تحصيل، رواتب، مصروفات، وصافي ربح لكل مدرس"
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="إيرادات الشهر"
          value={formatCurrency(kpis.monthRevenue)}
          icon={Banknote}
          tone="success"
        />
        <StatCard
          label="إجمالي الرواتب"
          value={formatCurrency(kpis.salariesTotal)}
          icon={PiggyBank}
          tone={kpis.salariesTotal > 0 ? "warning" : "success"}
        />
        <StatCard
          label="إجمالي المصروفات"
          value={formatCurrency(kpis.expensesTotal)}
          icon={Receipt}
          tone={kpis.expensesTotal > 0 ? "warning" : "success"}
        />
        <StatCard
          label="صافي الربح"
          value={formatCurrency(kpis.netProfit)}
          icon={TrendingUp}
          tone={kpis.netProfit >= 0 ? "success" : "destructive"}
          trend={`هامش ${formatPercent(kpis.netMarginPct)}`}
        />
      </div>

      {/* 4 كروت إضافية (§0.3) — اشتراكات + مؤشرات التحصيل */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="اشتراكات نشطة"
          value={formatNumber(students.filter((s) => s.payment_status === "paid").length)}
          icon={Wallet}
          tone="success"
          trend={`من إجمالي ${formatNumber(students.length)} طالب`}
        />
        <StatCard
          label="إجمالي قيمة اشتراكات المواد"
          value={formatCurrency(
            students.reduce((s, st) => {
              const fees = st.subject_fees ?? {};
              return s + Object.values(fees).reduce((a: number, b: unknown) => a + Number(b), 0);
            }, 0),
          )}
          icon={Wallet}
        />
        <StatCard
          label="متوسط قيمة الاشتراك للطالب"
          value={formatCurrency(
            students.length === 0
              ? 0
              : Math.round(
                  students.reduce((s, st) => {
                    const fees = st.subject_fees ?? {};
                    return s + Object.values(fees).reduce((a: number, b: unknown) => a + Number(b), 0);
                  }, 0) / students.length,
                ),
          )}
          icon={Wallet}
        />
        <StatCard
          label="نسبة التحصيل الفعلي من المستحق"
          value={formatPercent(
            kpis.overdueTotal + kpis.monthRevenue > 0
              ? Math.round(
                  (kpis.monthRevenue / (kpis.overdueTotal + kpis.monthRevenue)) * 100,
                )
              : 0,
          )}
          icon={ArrowDownRight}
          tone={kpis.overdueTotal === 0 ? "success" : "warning"}
        />
      </div>

      <Panel title="التحليل الآلي للشهر" description="قبل الخصم وبعده، مع توزيع أنظمة الدفع">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Mini label="طلاب النظام الشهري" value={formatNumber(monthlyStudents)} icon={Users} />
          <Mini label="طلاب نظام الحصة" value={formatNumber(perSessionStudents)} icon={Users} />
          <Mini
            label="المادة الأعلى إيراداً"
            value={topSubject ? topSubject.name : "—"}
            icon={Crown}
            hint={
              topSubject
                ? `متوقع ${formatCurrency(topSubject.expected)} · محصَّل ${formatCurrency(topSubject.collected)} · ${formatNumber(topSubject.students)} طالب`
                : undefined
            }
          />
          <Mini
            label="المستحقات المتأخرة"
            value={formatCurrency(kpis.overdueTotal)}
            icon={Wallet}
          />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border-2 border-border p-4">
            <p className="text-sm font-bold text-muted-foreground">الإيراد قبل الخصم</p>
            <p className="kpi-number text-2xl">{formatCurrency(grossBefore)}</p>
          </div>
          <div className="rounded-xl border-2 border-border p-4">
            <p className="text-sm font-bold text-muted-foreground">
              إجمالي الخصومات (رواتب + مصروفات)
            </p>
            <p className="kpi-number text-2xl">
              {formatCurrency(kpis.salariesTotal + kpis.expensesTotal)}
            </p>
          </div>
          <div className="rounded-xl border-2 border-border p-4">
            <p className="text-sm font-bold text-muted-foreground">الصافي بعد الخصم</p>
            <p className="kpi-number text-2xl">{formatCurrency(kpis.netProfit)}</p>
            <p className="mt-1 text-sm font-bold text-muted-foreground">
              {formatPercent(kpis.netMarginPct)} من الإيراد
            </p>
          </div>
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="التحصيل حسب وسيلة الدفع" description="من عمليات الكاشير الفعلية">
          <div className="space-y-4">
            {byMethod.map((m) => {
              const share = kpis.monthRevenue ? Math.round((m.total / kpis.monthRevenue) * 100) : 0;
              return (
                <div key={m.method} className="rounded-xl border-2 border-border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-base font-black text-foreground">{METHOD_LABEL[m.method]}</p>
                    <span className="kpi-number text-lg">{formatCurrency(m.total)}</span>
                  </div>
                  <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-navy" style={{ width: `${share}%` }} />
                  </div>
                  <p className="mt-2 text-sm font-bold text-muted-foreground">
                    {formatPercent(share)} · {formatNumber(m.count)} عملية
                  </p>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="إيراد كل مادة" description="محصَّل فعلي مقابل المتوقع من أسعار المواد">
          <div className="space-y-3">
            {subjectRevenue.length === 0 ? (
              <Empty text="لا توجد مواد مسجّلة بعد." />
            ) : (
              subjectRevenue.map((s) => (
                <div key={s.id} className="rounded-xl border-2 border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-base font-black text-foreground">{s.name}</p>
                    <span className="kpi-number text-lg">{formatCurrency(s.collected)}</span>
                  </div>
                  <p className="mt-1 text-sm font-bold text-muted-foreground">
                    {formatNumber(s.students)} طالب · متوقع {formatCurrency(s.expected)}
                  </p>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>

      <Panel
        title="تحليل تفصيلي لكل مدرس"
        description="إيراد طلابه مقابل راتبه = الصافي الفعلي للسنتر من كل مدرس"
      >
        {teacherFinance.length === 0 ? (
          <Empty text="لا يوجد مدرسون مسجّلون بعد." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-lg">
              <thead>
                <tr className="border-b-2 border-border text-base font-black text-muted-foreground">
                  <th className="px-4 py-4">المدرس</th>
                  <th className="px-4 py-4">المادة</th>
                  <th className="px-4 py-4">الطلاب</th>
                  <th className="px-4 py-4">إيراد طلابه</th>
                  <th className="px-4 py-4">راتبه</th>
                  <th className="px-4 py-4">صافي السنتر</th>
                </tr>
              </thead>
              <tbody>
                {teacherFinance.map((t) => (
                  <tr
                    key={t.teacherId}
                    className="border-b border-border last:border-0 transition-colors hover:bg-muted/40"
                  >
                    <td className="px-4 py-4 text-lg font-black text-foreground">{t.name}</td>
                    <td className="px-4 py-4 text-base font-bold text-muted-foreground">{t.subject}</td>
                    <td className="px-4 py-4 text-lg font-extrabold">{formatNumber(t.studentsCount)}</td>
                    <td className="px-4 py-4 text-lg font-extrabold text-success">
                      {formatCurrency(t.revenue)}
                    </td>
                    <td className="px-4 py-4 text-lg font-extrabold text-destructive">
                      {formatCurrency(t.salary)}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-xl border-2 px-3 py-1.5 text-lg font-black",
                          t.net >= 0
                            ? "border-blue-500/40 bg-blue-500/10 text-blue-700"
                            : "border-destructive/40 bg-destructive/5 text-destructive",
                        )}
                      >
                        {formatCurrency(t.net)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="آخر عملية تحصيل" description="أحدث حركة حقيقية على قاعدة البيانات">
          {lastPayment ? (
            <div className="rounded-xl border-2 border-success/40 bg-success/5 p-5">
              <p className="text-lg font-black text-foreground">{lastPayment.student_name}</p>
              <p className="mt-1 text-sm font-bold text-muted-foreground">
                {lastPayment.item} · {lastPayment.student_code} ·{" "}
                {formatDateTime(lastPayment.created_at)}
              </p>
              <p className="kpi-number mt-3 text-3xl text-success">
                {formatCurrency(Number(lastPayment.amount))}
              </p>
              <StatusBadge tone="neutral">{METHOD_LABEL[lastPayment.method]}</StatusBadge>
            </div>
          ) : (
            <Empty text="لا توجد عمليات تحصيل بعد." />
          )}
        </Panel>

        <Panel
          title="آخر عمليات التحصيل"
          description="مباشرة من شباك الكاشير"
          className="xl:col-span-2"
        >
          {payments.length === 0 ? (
            <Empty text="لا توجد عمليات تحصيل مسجّلة بعد." />
          ) : (
            <div className="max-h-[26rem] space-y-3 overflow-y-auto pl-1">
              {payments.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-border p-4"
                >
                  <div>
                    <p className="text-base font-black text-foreground">{p.student_name}</p>
                    <p className="text-sm font-bold text-muted-foreground">
                      {p.item} · {p.student_code} · {p.created_at}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge tone="neutral">{METHOD_LABEL[p.method]}</StatusBadge>
                    <span className="flex items-center gap-1 text-base font-black text-success">
                      <ArrowDownRight className="size-4" />
                      {formatCurrency(Number(p.amount))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="مرجع أسعار المواد" description="الأساس الذي يُحسب منه إجمالي رسوم أي طالب">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {state.subjectPrices.length === 0 ? (
            <Empty text="لم يتم تحديد أسعار المواد بعد — حددها من صفحة الخزنة والنظام المالي." />
          ) : (
            state.subjectPrices.map((p) => (
              <div key={p.id} className="rounded-xl border-2 border-border p-4">
                <p className="text-base font-black text-foreground">{p.subject_name}</p>
                <p className="mt-1 text-sm font-bold text-muted-foreground">
                  شهري {formatCurrency(Number(p.monthly_price))} · بالحصة{" "}
                  {formatCurrency(Number(p.per_session_price))}
                </p>
              </div>
            ))
          )}
        </div>
        <p className="mt-3 text-sm font-bold text-muted-foreground">
          مثال: طالب مسجّل في كل المواد الحالية إجماليه الشهري{" "}
          {formatCurrency(
            computeStudentFees(
              state,
              subjects.map((s) => s.id),
            ).monthly,
          )}
          .
        </p>
      </Panel>
    </AppShell>
  );
}

function Mini({
  label,
  value,
  icon: Icon,
  hint,
}: {
  label: string;
  value: string;
  icon: typeof Users;
  hint?: string | undefined;
}) {
  return (
    <div className="rounded-xl border-2 border-border p-4">
      <p className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
        <Icon className="size-4 text-primary" />
        {label}
      </p>
      <p className="kpi-number mt-1 text-2xl">{value}</p>
      {hint ? <p className="mt-1 text-sm font-bold text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-xl border-2 border-dashed border-border p-6 text-center text-base font-bold text-muted-foreground">
      {text}
    </p>
  );
}
