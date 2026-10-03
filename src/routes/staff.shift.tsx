import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Banknote, CheckCircle2, ClipboardCheck, LockKeyhole, TrendingUp, Users } from "lucide-react";
import { toast } from "sonner";

import { Panel, StatCard, StatusBadge } from "@/components/dashboard/StatCard";
import { AppShell } from "@/components/layout/AppShell";
import { closeShift, getCurrentShiftPayments, useDataStore } from "@/lib/data-store";
import { formatCurrency, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/staff/shift")({
  head: () => ({
    meta: [
      { title: "تقفيل الوردية — السكرتارية" },
      {
        name: "description",
        content: "مطابقة النقدية وتقرير نهاية الوردية قبل تسليم الخزنة.",
      },
    ],
  }),
  component: ShiftPage,
});

function ShiftPage() {
  const state = useDataStore();
  const { attendanceRecords, shiftClosures } = state;
  // عمليات الوردية الحالية فقط (منذ آخر تقفيل) — لا كل تاريخ السنتر، وإلا كل
  // وردية تالية للأولى كانت تحسب "المتوقع" على إجمالي كل الورديات السابقة
  // مجمّعة. راجع تعليق getCurrentShiftPayments في data-store.ts.
  const payments = useMemo(() => getCurrentShiftPayments(state), [state]);
  const systemTotal = payments.reduce((s, p) => s + p.amount, 0);
  /**
   * "المبلغ المتوقع" هنا هو نقدية فعلية داخل الدرج (الحقل نفسه معنون "المبلغ
   * الفعلي داخل الدرج") — كان يُحسب من كل طرق الدفع مجتمعة، بما فيها المحفظة/
   * إنستاباي/تحويل بنكي/فوري اللي **لا تدخل الدرج فعلياً إطلاقاً**. ده كان
   * يُظهر "عجز" دائم في الخزنة بقيمة كل المدفوعات الرقمية حتى لو الدرج مطابق
   * ١٠٠٪. المطابقة الصحيحة: نقدي فقط.
   */
  const cashPayments = useMemo(() => payments.filter((p) => p.method === "cash"), [payments]);
  const gatewayPayments = useMemo(() => payments.filter((p) => p.method !== "cash"), [payments]);
  const expected = cashPayments.reduce((s, p) => s + p.amount, 0);
  const gatewayTotal = gatewayPayments.reduce((s, p) => s + p.amount, 0);
  const [counted, setCounted] = useState(expected);
  // لو الموظف لسه ما لمسش الحقل، نفضل نحدّث القيمة الافتراضية مع أي تحصيل جديد
  // يدخل أثناء فتح الشاشة — بدل ما تفضل مجمّدة على أول رقم ظهر عند التحميل.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setCounted(expected);
  }, [expected, touched]);
  const [closed, setClosed] = useState(false);
  // بعد التقفيل، الفرق المعروض هو نفسه اللي اتسجّل فعلياً وقت الضغط على الزرار
  // (راجع من closeShift)، مش قيمة بتتحسب تاني من بيانات ممكن تكون اتغيّرت بعد كده.
  const [closedResult, setClosedResult] = useState<{ expected: number; diff: number } | null>(
    null,
  );
  const diff = closedResult ? closedResult.diff : counted - expected;

  const last5 = useMemo(() => shiftClosures.slice(0, 5), [shiftClosures]);
  const avgCounted = last5.length
    ? last5.reduce((s, c) => s + Number(c.counted), 0) / last5.length
    : 0;
  const avgExpected = last5.length
    ? last5.reduce((s, c) => s + Number(c.expected), 0) / last5.length
    : 0;
  const avgDiff = last5.length
    ? last5.reduce((s, c) => s + Number(c.diff), 0) / last5.length
    : 0;

  const lastHourAbsent = attendanceRecords.some(
    (a) =>
      a.status === "absent" &&
      (() => {
        const t = Date.parse(a.checked_in_at);
        return !Number.isNaN(t) && Date.now() - t < 3600000;
      })(),
  );
  const cleanShift = diff === 0 && !lastHourAbsent && !closed;

  return (
    <AppShell role="staff" title="تقفيل الوردية" description="مطابقة النقدية وتسليم تقرير اليوم">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="إجمالي النظام (كل الطرق)" value={formatCurrency(systemTotal)} icon={Banknote} />
        <StatCard
          label="نقدي متوقع في الدرج"
          value={formatCurrency(expected)}
          icon={ClipboardCheck}
        />
        <StatCard
          label="بوابة الدفع (محفظة/إنستاباي/فوري/تحويل)"
          value={formatCurrency(gatewayTotal)}
          icon={TrendingUp}
        />
        <StatCard
          label="حضور مسجل"
          value={formatNumber(attendanceRecords.filter((a) => a.status !== "absent").length)}
          icon={Users}
          tone="success"
        />
        <StatCard
          label="فرق الخزنة النقدية"
          value={formatCurrency(diff)}
          icon={LockKeyhole}
          tone={diff === 0 ? "success" : "destructive"}
        />
      </div>

      <Panel
        title="مقارنة إجمالي النظام مع بوابة الدفع"
        description="تقسيم عمليات الوردية الحالية حسب طريقة الدفع — نقدي مقابل الطرق الرقمية"
      >
        <table className="w-full text-sm">
          <thead className="text-xs font-black text-muted-foreground">
            <tr>
              <th className="py-2 text-right">البند</th>
              <th className="py-2 text-right">عدد العمليات</th>
              <th className="py-2 text-right">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              <td className="py-2 font-black">إجمالي النظام</td>
              <td className="py-2">{formatNumber(payments.length)}</td>
              <td className="py-2 font-black">{formatCurrency(systemTotal)}</td>
            </tr>
            <tr className="border-t border-border">
              <td className="py-2 font-black">نقدي</td>
              <td className="py-2">{formatNumber(cashPayments.length)}</td>
              <td className="py-2">{formatCurrency(expected)}</td>
            </tr>
            <tr className="border-t border-border">
              <td className="py-2 font-black">بوابة الدفع</td>
              <td className="py-2">{formatNumber(gatewayPayments.length)}</td>
              <td className="py-2">{formatCurrency(gatewayTotal)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-xs font-bold text-muted-foreground">
          {systemTotal === expected + gatewayTotal
            ? "✓ النقدي + بوابة الدفع يطابقان إجمالي النظام تماماً."
            : "⚠ فرق غير متوقع بين إجمالي النظام ومجموع النقدي وبوابة الدفع — راجع سجل العمليات."}
        </p>
      </Panel>

      {cleanShift ? (
        <div className="flex items-center gap-2 rounded-2xl border-2 border-success/40 bg-success/15 p-3 text-sm font-black text-success">
          <CheckCircle2 className="size-4" />
          وردية نظيفة — الخزنة مطابقة ولا حالات غياب في الساعة الأخيرة.
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="مطابقة النقدية" description="أدخل المبلغ الفعلي داخل الدرج">
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-black">المبلغ المتوقع</p>
              <p className="kpi-number text-3xl">{formatCurrency(expected)}</p>
            </div>
            <div>
              <p className="mb-2 text-sm font-black">المبلغ الفعلي</p>
              <input
                type="number"
                value={counted}
                onChange={(e) => {
                  setTouched(true);
                  setCounted(Number(e.target.value));
                }}
                disabled={closed}
                className="h-16 w-full rounded-2xl border-2 border-border bg-background px-4 text-3xl font-black outline-none focus:border-primary disabled:opacity-60"
              />
            </div>
            <StatusBadge tone={diff === 0 ? "success" : diff > 0 ? "warning" : "destructive"}>
              {diff === 0 ? "مطابق تماماً" : `فرق ${formatCurrency(diff)}`}
            </StatusBadge>

            <button
              onClick={() => {
                if (!window.confirm("متأكد إنك عايز تقفل الوردية بالمبلغ ده؟ العملية دي نهائية.")) return;
                setClosedResult(closeShift(counted));
                setClosed(true);
                toast.success("تم تقفيل الوردية وإرسال التقرير للمالك");
              }}
              disabled={closed}
              className="h-14 w-full rounded-2xl bg-navy text-lg font-black text-navy-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {closed ? "تم التقفيل ✓" : "تقفيل الوردية"}
            </button>
          </div>
        </Panel>

        <Panel
          title="مقارنة مع آخر 5 ورديات"
          description={last5.length ? `متوسط ${formatNumber(last5.length)} ورديات سابقة` : "لا يوجد سجل ورديات بعد"}
          actions={
            <span className="flex items-center gap-1 text-xs font-black text-muted-foreground">
              <TrendingUp className="size-3" /> مرجع
            </span>
          }
        >
          <table className="w-full text-sm">
            <thead className="text-xs font-black text-muted-foreground">
              <tr>
                <th className="py-2 text-right">البند</th>
                <th className="py-2 text-right">اليوم</th>
                <th className="py-2 text-right">المتوسط</th>
                <th className="py-2 text-right">الفرق</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                <td className="py-2 font-black">المتوقع</td>
                <td className="py-2 font-black">{formatCurrency(expected)}</td>
                <td className="py-2">{formatCurrency(avgExpected)}</td>
                <td className={cn("py-2", expected - avgExpected >= 0 ? "text-success" : "text-destructive")}>
                  {expected - avgExpected >= 0 ? "+" : ""}
                  {formatCurrency(expected - avgExpected)}
                </td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-2 font-black">الفعلي</td>
                <td className="py-2 font-black">{formatCurrency(counted)}</td>
                <td className="py-2">{formatCurrency(avgCounted)}</td>
                <td className={cn("py-2", counted - avgCounted >= 0 ? "text-success" : "text-destructive")}>
                  {counted - avgCounted >= 0 ? "+" : ""}
                  {formatCurrency(counted - avgCounted)}
                </td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-2 font-black">الفرق</td>
                <td className="py-2 font-black">{formatCurrency(diff)}</td>
                <td className="py-2">{formatCurrency(avgDiff)}</td>
                <td className="py-2 text-muted-foreground">—</td>
              </tr>
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel title="تقرير الوردية" description="ملخص العمليات المرسل للمالك">
        <div className="space-y-3">
          {payments.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-xl border-2 border-border p-3"
            >
              <div className="min-w-0">
                <p className="truncate font-black text-foreground">{p.student_name}</p>
                <p className="truncate text-xs font-bold text-muted-foreground">{p.item}</p>
              </div>
              <span className="font-black text-primary">{formatCurrency(p.amount)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between rounded-xl border-2 border-navy bg-navy p-4 text-navy-foreground">
            <span className="font-black">الإجمالي المسلَّم</span>
            <span className="text-xl font-black">{formatCurrency(counted)}</span>
          </div>
        </div>
      </Panel>
    </AppShell>
  );
}
