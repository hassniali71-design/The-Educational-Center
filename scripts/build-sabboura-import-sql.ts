/**
 * بيبني ملف SQL واحد لنقل طلاب «المتفوقين» من sabboura_import/ لسنتر المتفوقين على المنصة.
 * مش بيكلّم القاعدة خالص — بيكتب ملف بس، والمالك هو اللي يطبّقه في SQL Editor.
 *
 * الموافقات (14/11/2026): المدفوعات القديمة بطريقة "legacy"، وحساب لكل طالب بكود 20 + 6 أرقام
 * من غير كلمة سر، والمنسحبين ومتابعة الحجز يفضلوا في الأرشيف (import_sabboura) بس.
 *
 *   bun run scripts/build-sabboura-import-sql.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const CENTER = "ctr-1794456690821";
const OUT_DIR = "D:/erp Systems/_reports/scholariq-sql";
const SRC = "sabboura_import";

const d = JSON.parse(readFileSync(`${SRC}/sabboura_import.json`, "utf8"));

const SUBJECT_ID: Record<string, string> = {
  arabic: `${CENTER}-sub-1`,
  english: `${CENTER}-sub-2`,
  math: `${CENTER}-sub-3`,
  social_studies: `${CENTER}-sub-4`,
  science: `${CENTER}-sub-5`,
};
const STATUS: Record<string, string> = {
  paid_up: "paid",
  exempt: "paid",
  due_current: "pending",
  overdue: "overdue",
};

const q = (v: string | null | undefined) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const num = (v: unknown) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`رقم غلط: ${v}`);
  return String(n);
};
const slug = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "-");

// ---------- الطلاب ----------
type Student = (typeof d.students)[number];
const studentRows: string[] = [];
let feesTotal = 0;
for (const s of d.students as Student[]) {
  const enr = (d.enrollments as any[]).filter((e) => e.student_code === s.student_code && e.status === "active");
  const fees: Record<string, number> = {};
  for (const e of enr) {
    const id = SUBJECT_ID[e.subject_code];
    if (!id) throw new Error(`مادة مش معروفة: ${e.subject_code}`);
    fees[id] = s.exempt ? 0 : Number(e.price_per_month);
  }
  // الخصم (إخوة توفيق 50) مفيش له عمود — بيتخصم من آخر مادة.
  const discount = Number(s.monthly_discount) || 0;
  if (discount > 0) {
    const last = Object.keys(fees).at(-1)!;
    fees[last] = fees[last]! - discount;
  }
  const monthly = Object.values(fees).reduce((a, b) => a + b, 0);
  if (monthly !== Number(s.monthly_fee)) {
    throw new Error(`${s.student_code}: مجموع المواد ${monthly} ≠ الاشتراك ${s.monthly_fee}`);
  }
  feesTotal += monthly;
  const status = STATUS[s.payment_status];
  if (!status) throw new Error(`حالة مش معروفة: ${s.payment_status}`);
  const day = Number(String(s.join_date).slice(8, 10));
  const phone = s.phone_e164 ?? s.phone_raw ?? "";
  studentRows.push(
    `(${q(s.student_code)}, ${q(s.name)}, ${num(s.grade)}, ${q(phone)}, ` +
      `array[${Object.keys(fees).map(q).join(", ")}]::text[], ${q(JSON.stringify(fees))}::jsonb, ` +
      `${num(s.balance_due)}, ${q(status)}, ${day >= 1 && day <= 28 ? day : "null"}, ` +
      `${Math.round(Number(s.attendance_rate ?? 0) * 100)})`,
  );
}

// ---------- المدفوعات ----------
const cycles = new Map<string, any>();
for (const c of d.billing_cycles as any[]) cycles.set(`${c.student_code}#${c.cycle_no}`, c);
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const paymentRows: string[] = [];
let paidTotal = 0;
for (const p of d.payments as any[]) {
  const c = cycles.get(`${p.student_code}#${p.cycle_no}`);
  const period = c ? ` (${ddmm(c.period_start)} – ${ddmm(c.period_end)})` : "";
  const item = `اشتراك الشهر ${p.cycle_no}${period} — مرحّلة من الشيت، التاريخ تقديري`;
  paidTotal += Number(p.amount);
  paymentRows.push(
    `(${q(`pm-sab-${slug(p.student_code)}-c${p.cycle_no}`)}, ${q(p.student_code)}, ${num(p.amount)}, ` +
      `${q(item)}, ${q(`${p.paid_on}T00:00:00+02:00`)})`,
  );
}

// ---------- مهمة جودي (قرار إدارة) ----------
const judy = (d.students as Student[]).find((s) => s.student_code === "SAB-041")!;

const meta = d.meta.totals;
if (feesTotal !== meta.monthly_fees) throw new Error(`مجموع الاشتراكات ${feesTotal} ≠ ${meta.monthly_fees}`);
if (paidTotal !== meta.total_paid) throw new Error(`مجموع المدفوع ${paidTotal} ≠ ${meta.total_paid}`);

// ---------- الأرشيف (staging_seed.sql من غير begin/commit بتوعه) ----------
const staging = readFileSync(`${SRC}/staging_seed.sql`, "utf8")
  .replace(/^\uFEFF/, "")
  .replace(/^\s*begin;\s*$/im, "")
  .replace(/^\s*commit;\s*$/im, "");

const now = new Date().toISOString();

const apply = `-- نقل طلاب «المتفوقين» من شيت الإكسل لسنتر المتفوقين (${CENTER}).
-- القاعدة: The-Educational-Center (kqmjzwtwiuvyjxlksdmf). اتأكد إن الرابط فوق فيه kqmjzwtwiuvyjxlksdmf قبل Run.
-- اتعمل بـ scripts/build-sabboura-import-sql.ts من sabboura_import/sabboura_import.json — متعدلش هنا.
-- كله في transaction واحدة: يا يتطبق كله، يا ولا حاجة. تشغيله مرتين مش بيكرر حاجة (بيتخطى اللي اتنقل).
-- الرجوع: 02-sabboura-students-UNDO.sql
begin;

do $$
begin
  if not exists (select 1 from public.centers where id = '${CENTER}') then
    raise exception 'وقف: سنتر المتفوقين (${CENTER}) مش موجود — ده مش المشروع الصح';
  end if;
  if (select count(*) from public.grades where center_id = '${CENTER}') < 6 then
    raise exception 'وقف: صفوف السنتر ناقصة';
  end if;
end $$;

-- ١) تعديلات صغيرة في الجداول
alter table public.students add column if not exists legacy_code text;
create unique index if not exists idx_students_legacy_code on public.students (legacy_code) where legacy_code is not null;
comment on column public.students.legacy_code is 'كود الطالب في شيت الإكسل القديم (SAB-001...) — مفتاح النقل';

alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash', 'wallet', 'instapay', 'bank_transfer', 'fawry', 'legacy'));

-- ٢) الأرشيف: كل ملفات الاستيراد زي ما هي في schema منفصلة import_sabboura (قراية بس، مش ظاهرة للموقع)
${staging}
revoke all on schema import_sabboura from public, anon, authenticated;
revoke all on all tables in schema import_sabboura from public, anon, authenticated;

-- ٣) الطلاب + حساب دخول لكل طالب (كود 20 + 6 أرقام، من غير كلمة سر)
create temp table _sab (
  legacy_code text, full_name text, grade_order int, phone text,
  subject_ids text[], fees jsonb, balance numeric, status text, due_day int, attendance int
) on commit drop;

insert into _sab values
${studentRows.join(",\n")};

do $$
declare
  r record;
  v_code text;
  v_grade text;
begin
  for r in select * from _sab order by legacy_code loop
    if exists (select 1 from public.students where legacy_code = r.legacy_code) then
      continue; -- اتنقل قبل كده
    end if;

    select name into v_grade from public.grades
      where center_id = '${CENTER}' and "order" = r.grade_order;
    if v_grade is null then
      raise exception 'وقف: الصف % مش موجود (%)', r.grade_order, r.legacy_code;
    end if;

    loop
      v_code := '20' || lpad((floor(random() * 1000000))::int::text, 6, '0');
      exit when not exists (select 1 from public.accounts where identifier = v_code)
            and not exists (select 1 from public.students where code = v_code);
    end loop;

    insert into public.accounts (id, center_id, role, full_name, phone, identifier, password, password_hash, created_at)
    values ('acc-sab-' || lower(r.legacy_code), '${CENTER}', 'student', r.full_name, r.phone, v_code, null, null, now());

    insert into public.students (
      id, center_id, code, full_name, grade, group_name, group_id, guardian_name, guardian_phone,
      payment_status, balance_due, points, attendance_rate, avg_score, subject_ids,
      billing_plan, subject_fees, billing_mode, due_day_of_month, legacy_code
    ) values (
      'st-sab-' || lower(r.legacy_code), '${CENTER}', v_code, r.full_name, v_grade, v_grade, null, '', r.phone,
      r.status, r.balance, 0, r.attendance, 0, r.subject_ids,
      'monthly', r.fees, 'monthly', r.due_day, r.legacy_code
    );
  end loop;
end $$;

-- ٤) المدفوعات القديمة (طريقة الدفع legacy = مرحّلة من الشيت، مش بتدخل في الوردية)
create temp table _sab_pay (id text, legacy_code text, amount numeric, item text, created_at text) on commit drop;
insert into _sab_pay values
${paymentRows.join(",\n")};

insert into public.payments (id, center_id, student_name, student_code, amount, method, item, created_at)
select p.id, '${CENTER}', s.full_name, s.code, p.amount, 'legacy', p.item, p.created_at
from _sab_pay p
join public.students s on s.legacy_code = p.legacy_code and s.center_id = '${CENTER}'
on conflict (id) do nothing;

-- ٥) مهمة للموظفة: قرار جودي عبد المعتمد
insert into public.tasks (id, center_id, title, task_type, assignee_role, assignee_id, assignee_name,
  created_by_id, created_by_name, priority, is_urgent, status, note, due_at, completed_at, created_at, updated_at)
values ('task-sab-041-decision', '${CENTER}', ${q(`قرار مطلوب: ${judy.name}`)}, 'follow_up', 'staff', null, 'السكرتارية',
  null, 'نقل البيانات من الشيت', 'high', true, 'pending', ${q(judy.decision_required)}, null, null, ${q(now)}, ${q(now)})
on conflict (id) do nothing;

-- ٦) التأكد قبل الحفظ — لو أي رقم غلط، كله بيرجع
do $$
declare
  v_students int; v_fees numeric; v_balance numeric; v_pay_n int; v_pay numeric; v_acc int;
begin
  select count(*), coalesce(sum((select sum(value::numeric) from jsonb_each_text(subject_fees))), 0), coalesce(sum(balance_due), 0)
    into v_students, v_fees, v_balance
    from public.students where center_id = '${CENTER}' and legacy_code is not null;
  select count(*), coalesce(sum(amount), 0) into v_pay_n, v_pay
    from public.payments where center_id = '${CENTER}' and method = 'legacy';
  select count(*) into v_acc from public.accounts
    where center_id = '${CENTER}' and role = 'student' and identifier ~ '^20[0-9]{6}$' and password_hash is null and password is null;
  if v_students <> ${d.students.length} or v_fees <> ${meta.monthly_fees} or v_balance <> ${meta.balance_due}
     or v_pay_n <> ${d.payments.length} or v_pay <> ${meta.total_paid} or v_acc < ${d.students.length} then
    raise exception 'وقف: الأرقام مش مطابقة — طلاب % اشتراكات % متبقي % دفعات % (%) حسابات %',
      v_students, v_fees, v_balance, v_pay_n, v_pay, v_acc;
  end if;
end $$;

select
  (select count(*) from public.students where center_id = '${CENTER}' and legacy_code is not null) as students,
  (select sum(balance_due) from public.students where center_id = '${CENTER}' and legacy_code is not null) as balance_due,
  (select count(*) from public.payments where center_id = '${CENTER}' and method = 'legacy') as payments,
  (select sum(amount) from public.payments where center_id = '${CENTER}' and method = 'legacy') as paid;

commit;
`;

const undo = `-- رجوع ملف 02: بيشيل اللي اتنقل من الشيت بس (بالأكواد sab)، ومش بيلمس أي حاجة اتعملت من الشاشة.
-- تحذير: لو اتسجلت دفعات حقيقية من الكاشير على الطلاب دول بعد النقل، هتفضل موجودة — راجعها الأول.
begin;
delete from public.tasks where id = 'task-sab-041-decision';
delete from public.payments where center_id = '${CENTER}' and method = 'legacy' and id like 'pm-sab-%';
delete from public.students where center_id = '${CENTER}' and id like 'st-sab-%';
delete from public.accounts where center_id = '${CENTER}' and id like 'acc-sab-%';
drop schema if exists import_sabboura cascade;
-- طريقة الدفع legacy: بترجع للقديم بس لو مفيش ولا دفعة بيها
do $$
begin
  if not exists (select 1 from public.payments where method = 'legacy') then
    alter table public.payments drop constraint if exists payments_method_check;
    alter table public.payments add constraint payments_method_check
      check (method in ('cash', 'wallet', 'instapay', 'bank_transfer', 'fawry'));
  end if;
end $$;
-- عمود legacy_code بيفضل (فاضي ومش مضر)؛ لو عاوز تشيله:
-- drop index if exists idx_students_legacy_code; alter table public.students drop column if exists legacy_code;
commit;
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/02-sabboura-students.sql`, apply, "utf8");
writeFileSync(`${OUT_DIR}/02-sabboura-students-UNDO.sql`, undo, "utf8");
console.log(
  `OK: ${d.students.length} طالب، اشتراكات ${feesTotal}، ${d.payments.length} دفعة = ${paidTotal}، متبقي ${meta.balance_due}`,
);
