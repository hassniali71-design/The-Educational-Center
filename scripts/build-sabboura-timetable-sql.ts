/**
 * المرحلة 2: بيبني ملف SQL واحد لجدول حصص «المتفوقين» (مدرسين + مجموعات + مواعيد + ربط الطلاب).
 * مش بيكلّم القاعدة — بيكتب ملف بس، والمالك هو اللي يطبّقه في SQL Editor.
 *
 * شكل المنصة: المجموعة = صف + مادة (بمدرسها)، وليها حصتين في الأسبوع في schedule_slots.
 * فالـ 6 مجموعات بتوع الملف (مجموعة لكل صف) بيبقوا 22 مجموعة (صف × مادة)، و44 حصة.
 * الطالب: group_id = مجموعة أول مادة ليه، وباقي مواده في student_group_enrollments.
 * المدرس: صف في teachers + حساب دخول بكود 30 + 6 أرقام من غير كلمة سر (زي الطلاب).
 *
 *   bun run scripts/build-sabboura-timetable-sql.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const CENTER = "ctr-1794456690821";
const OUT_DIR = "D:/erp Systems/_reports/scholariq-sql";
const SRC = "sabboura_timetable";

const d = JSON.parse(readFileSync(`${SRC}/sabboura_timetable.json`, "utf8"));

// المواد في السنتر: sub-1 عربي، sub-2 إنجليزي، sub-3 رياضيات، sub-4 دراسات، sub-5 علوم
const SUBJECT: Record<string, { id: string; name: string }> = {
  arabic: { id: `${CENTER}-sub-1`, name: "عربي" },
  english: { id: `${CENTER}-sub-2`, name: "إنجليزي" },
  math: { id: `${CENTER}-sub-3`, name: "رياضيات" },
  social_studies: { id: `${CENTER}-sub-4`, name: "دراسات" },
  science: { id: `${CENTER}-sub-5`, name: "علوم" },
};
const DAY: Record<string, string> = {
  sat: "السبت", sun: "الأحد", mon: "الاثنين", tue: "الثلاثاء", wed: "الأربعاء", thu: "الخميس",
};
// مس للمدرّسات، مستر للمدرسين
const HONORIFIC: Record<string, "mr" | "mrs"> = {
  "TCH-01": "mrs", "TCH-02": "mrs", "TCH-03": "mrs", "TCH-04": "mr", "TCH-05": "mr",
};

const q = (v: string | null | undefined) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const lc = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "-");
/** "15:00" → "03:00 PM" (نفس صيغة GroupScheduleModal) */
const time12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ap}`;
};
const teacherId = (code: string) => `tch-sab-${lc(code)}`;
const groupId = (grade: number, subject: string) => `grp-sab-g${grade}-${subject.replace(/_/g, "-")}`;

// ---------- المدرسين ----------
const teachers = d.teachers as any[];
const teacherRows = teachers.map((t) => {
  const s = SUBJECT[t.subject_code];
  if (!s) throw new Error(`مادة مش معروفة: ${t.subject_code}`);
  if (!HONORIFIC[t.teacher_code]) throw new Error(`مدرس مش معروف: ${t.teacher_code}`);
  return `(${q(t.teacher_code)}, ${q(teacherId(t.teacher_code))}, ${q(t.name)}, ${q(s.name)}, ${q(s.id)}, ${q(HONORIFIC[t.teacher_code])})`;
});

// ---------- الحصص والمجموعات ----------
const sessions = (d.weekly_sessions as any[]).slice().sort((a, b) =>
  a.iso_dow % 7 - b.iso_dow % 7 || a.start_time.localeCompare(b.start_time) || a.session_code.localeCompare(b.session_code),
);
const byGroup = new Map<string, any[]>();
for (const s of sessions) {
  if (!SUBJECT[s.subject_code] || !DAY[s.day_code]) throw new Error(`حصة غلط: ${s.session_code}`);
  const gid = groupId(s.grade, s.subject_code);
  byGroup.set(gid, [...(byGroup.get(gid) ?? []), s]);
}
// تعارض بالدقيقة (الحصة 45 دقيقة): نفس اليوم + تداخل في الوقت + نفس المدرس أو القاعة أو الصف
const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
for (const a of sessions) for (const b of sessions) {
  if (a.session_code >= b.session_code || a.day_code !== b.day_code) continue;
  const overlap = mins(a.start_time) < mins(b.end_time) && mins(b.start_time) < mins(a.end_time);
  if (overlap && (a.teacher_code === b.teacher_code || a.room_code === b.room_code || a.group_code === b.group_code)) {
    throw new Error(`تعارض: ${a.session_code} و ${b.session_code}`);
  }
}
for (const [gid, list] of byGroup) {
  if (list.length !== 2) throw new Error(`${gid}: ${list.length} حصص بدل 2`);
  if (new Set(list.map((x) => x.teacher_code)).size !== 1) throw new Error(`${gid}: أكتر من مدرس`);
}
const mixNote = (list: any[]) => {
  const mixes = [...new Set(list.map((x) => x.mix_pair).filter(Boolean))];
  return mixes.length ? `ماكس: ${mixes.join("، ")} — الصفين في نفس الوقت، كل صف في قاعة مع مدرس مختلف، والمدرسين بيتبادلوا. مدة الحصة 45 دقيقة.` : "مدة الحصة 45 دقيقة.";
};
const groupRows: string[] = [];
for (const [gid, list] of byGroup) {
  const first = list[0];
  const s = SUBJECT[first.subject_code]!;
  groupRows.push(
    `(${q(gid)}, ${first.grade}, ${q(s.name)}, ${q(s.id)}, ${q(first.teacher_code)}, ${q(DAY[first.day_code])}, ${q(time12(first.start_time))}, ${q(first.room_name)}, ${q(mixNote(list))})`,
  );
}
const slotRows = sessions.map((s) =>
  `(${q(`slot-sab-${lc(s.session_code)}`)}, ${q(groupId(s.grade, s.subject_code))}, ${q(s.teacher_code)}, ${q(DAY[s.day_code])}, ${q(time12(s.start_time))}, ${q(s.room_name)})`,
);

// ---------- ربط الطلاب ----------
const links = d.student_group_links as any[];
const linkRows = links.map((l) => {
  if (!SUBJECT[l.subject_code]) throw new Error(`مادة غلط في الربط: ${l.student_code}`);
  if (!byGroup.has(groupId(l.grade, l.subject_code))) throw new Error(`مفيش حصص لـ ${l.student_code} ${l.subject_code}`);
  return `(${q(l.student_code)}, ${q(groupId(l.grade, l.subject_code))}, ${q(SUBJECT[l.subject_code]!.id)})`;
});

const counts = d.meta.counts;
if (teachers.length !== 5 || sessions.length !== counts.weekly_sessions || links.length !== counts.student_group_links) {
  throw new Error("الأعداد مش مطابقة للـ meta");
}

const staging = readFileSync(`${SRC}/timetable_staging_seed.sql`, "utf8")
  .replace(/^\uFEFF/, "")
  .replace(/^\s*begin;\s*$/im, "")
  .replace(/^\s*commit;\s*$/im, "");

const now = new Date().toISOString();
const perTeacher = Object.fromEntries(teachers.map((t) => [t.teacher_code, t.sessions_per_week]));

const apply = `-- المرحلة 2: جدول حصص «المتفوقين» على سنتر المتفوقين (${CENTER}).
-- القاعدة: The-Educational-Center (kqmjzwtwiuvyjxlksdmf). اتأكد إن الرابط فوق فيه kqmjzwtwiuvyjxlksdmf قبل Run.
-- اتعمل بـ scripts/build-sabboura-timetable-sql.ts من sabboura_timetable/sabboura_timetable.json — متعدلش هنا.
-- كله في transaction واحدة، وتشغيله مرتين مش بيكرر حاجة. الرجوع: 03-sabboura-timetable-UNDO.sql
-- محتاج ملف 02 (الطلاب) يكون اتطبّق.
begin;

do $$
begin
  if not exists (select 1 from public.centers where id = '${CENTER}') then
    raise exception 'وقف: سنتر المتفوقين (${CENTER}) مش موجود — ده مش المشروع الصح';
  end if;
  if (select count(*) from public.students where center_id = '${CENTER}' and legacy_code is not null) <> 48 then
    raise exception 'وقف: طلاب المرحلة الأولى (ملف 02) مش موجودين كلهم';
  end if;
end $$;

-- ١) الأرشيف: ملفات الجدول زي ما هي في import_sabboura (جنب ملفات المرحلة الأولى)
${staging}
revoke all on all tables in schema import_sabboura from public, anon, authenticated;

-- ٢) المدرسين + حساب دخول لكل مدرس (كود 30 + 6 أرقام، من غير كلمة سر)
create temp table _tch (code text, id text, full_name text, subject text, subject_id text, honorific text) on commit drop;
insert into _tch values
${teacherRows.join(",\n")};

do $$
declare r record; v_code text;
begin
  for r in select * from _tch order by code loop
    if exists (select 1 from public.teachers where id = r.id) then continue; end if;
    loop
      v_code := '30' || lpad((floor(random() * 1000000))::int::text, 6, '0');
      exit when not exists (select 1 from public.accounts where identifier = v_code);
    end loop;
    insert into public.accounts (id, center_id, role, full_name, phone, identifier, password, password_hash, created_at)
    values ('acc-sab-' || lower(r.code), '${CENTER}', 'teacher', r.full_name, null, v_code, null, null, now());
    insert into public.teachers (id, center_id, user_id, full_name, subject, subject_id, groups, students,
      timer_compliance, sla_breaches, monthly_revenue, honorific, stages, primary_stage)
    values (r.id, '${CENTER}', v_code, r.full_name, r.subject, r.subject_id, 0, 0, 0, 0, 0, r.honorific, '{primary}', 'primary');
  end loop;
end $$;

-- ٣) المجموعات: مجموعة لكل (صف + مادة)، ومواعيدها أول حصة ليها في الأسبوع
create temp table _grp (id text, grade_order int, subject text, subject_id text, teacher_code text,
  weekday text, time12 text, room text, notes text) on commit drop;
insert into _grp values
${groupRows.join(",\n")};

insert into public.groups (id, center_id, name, subject, subject_id, teacher_name, teacher_id, teacher_user_id,
  grade, grade_id, weekday, "time", room, enrolled, capacity, scheduling_status, created_at, notes)
select g.id, '${CENTER}', gr.name || ' - ' || g.subject || ' - 1', g.subject, g.subject_id,
  t.full_name, t.id, t.user_id, gr.name, gr.id, g.weekday, g.time12, g.room, 0, 20, 'scheduled', '${now}', g.notes
from _grp g
join public.grades gr on gr.center_id = '${CENTER}' and gr."order" = g.grade_order
join public.teachers t on t.id = 'tch-sab-' || lower(g.teacher_code)
on conflict (id) do nothing;

-- ٤) الحصص الأسبوعية (44): حصتين لكل مجموعة
create temp table _slot (id text, group_id text, teacher_code text, weekday text, time12 text, room text) on commit drop;
insert into _slot values
${slotRows.join(",\n")};

insert into public.schedule_slots (id, center_id, teacher_id, teacher_name, subject_id, subject, grade,
  weekday, "time", room, group_id, updated_at)
select s.id, '${CENTER}', t.id, t.full_name, g.subject_id, g.subject, g.grade, s.weekday, s.time12, s.room, g.id, '${now}'
from _slot s
join public.groups g on g.id = s.group_id
join public.teachers t on t.id = 'tch-sab-' || lower(s.teacher_code)
on conflict (id) do nothing;

-- ٥) ربط الطلاب (129): أول مادة = المجموعة الأساسية، والباقي في student_group_enrollments
create temp table _link (legacy_code text, group_id text, subject_id text) on commit drop;
insert into _link values
${linkRows.join(",\n")};

with ranked as (
  select st.id student_id, l.group_id,
         row_number() over (partition by st.id order by array_position(st.subject_ids, l.subject_id), l.group_id) rn
  from _link l join public.students st on st.legacy_code = l.legacy_code and st.center_id = '${CENTER}'
)
update public.students st
set group_id = r.group_id, group_name = g.name
from ranked r join public.groups g on g.id = r.group_id
where st.id = r.student_id and r.rn = 1 and st.group_id is null;

insert into public.student_group_enrollments (id, center_id, student_id, group_id)
select 'sge-sab-' || lower(l.legacy_code) || '-' || l.group_id, '${CENTER}', st.id, l.group_id
from _link l join public.students st on st.legacy_code = l.legacy_code and st.center_id = '${CENTER}'
where st.group_id is distinct from l.group_id
on conflict (student_id, group_id) do nothing;

-- ٦) العدّادات: طلاب كل مجموعة، ومجموعات وطلاب كل مدرس
update public.groups g set enrolled = (
  select count(*) from public.students st
  where st.center_id = '${CENTER}'
    and (st.group_id = g.id or exists (select 1 from public.student_group_enrollments e where e.student_id = st.id and e.group_id = g.id))
) where g.center_id = '${CENTER}' and g.id like 'grp-sab-%';

update public.teachers t set
  groups = (select count(*) from public.groups g where g.teacher_id = t.id),
  students = (select coalesce(sum(g.enrolled), 0) from public.groups g where g.teacher_id = t.id)
where t.center_id = '${CENTER}' and t.id like 'tch-sab-%';

-- ٧) التأكد قبل الحفظ — لو أي رقم غلط، كله بيرجع
do $$
declare v_t int; v_g int; v_s int; v_links int; v_clash int; v_tacc int; v_room1 int; v_room2 int; v_per text;
begin
  select count(*) into v_t from public.teachers where center_id = '${CENTER}' and id like 'tch-sab-%';
  select count(*) into v_g from public.groups where center_id = '${CENTER}' and id like 'grp-sab-%';
  select count(*) into v_s from public.schedule_slots where center_id = '${CENTER}' and id like 'slot-sab-%';
  select count(*) into v_tacc from public.accounts where center_id = '${CENTER}' and role = 'teacher'
    and identifier ~ '^30[0-9]{6}$' and password_hash is null and password is null;
  select (select count(*) from public.students where center_id = '${CENTER}' and group_id like 'grp-sab-%')
       + (select count(*) from public.student_group_enrollments where center_id = '${CENTER}' and group_id like 'grp-sab-%')
    into v_links;
  -- تعارض: نفس اليوم ونفس الساعة لنفس المدرس أو نفس القاعة أو نفس الصف
  select count(*) into v_clash from public.schedule_slots a join public.schedule_slots b
    on a.id < b.id and a.center_id = b.center_id and a.weekday = b.weekday and a."time" = b."time"
   and (a.teacher_id = b.teacher_id or a.room = b.room or a.grade = b.grade)
   where a.center_id = '${CENTER}';
  select count(*) filter (where room = ${q(d.rooms[0].name)}), count(*) filter (where room = ${q(d.rooms[1].name)})
    into v_room1, v_room2 from public.schedule_slots where center_id = '${CENTER}' and id like 'slot-sab-%';
  if v_t <> 5 or v_g <> ${byGroup.size} or v_s <> ${sessions.length} or v_links <> ${links.length}
     or v_clash <> 0 or v_tacc < 5 or v_room1 <> 22 or v_room2 <> 22 then
    raise exception 'وقف: الأرقام مش مطابقة — مدرسين % مجموعات % حصص % ربط % تعارض % حسابات % قاعات %/%',
      v_t, v_g, v_s, v_links, v_clash, v_tacc, v_room1, v_room2;
  end if;
end $$;

select t.full_name as teacher, count(s.*) as sessions_per_week
from public.teachers t left join public.schedule_slots s on s.teacher_id = t.id
where t.center_id = '${CENTER}' and t.id like 'tch-sab-%'
group by t.full_name order by 2 desc;
-- المتوقع: ${JSON.stringify(perTeacher)}

commit;
`;

const undo = `-- رجوع ملف 03: بيشيل الجدول والمدرسين اللي اتنقلوا من الملف بس (الأكواد sab)، والطلاب نفسهم بيفضلوا.
begin;
delete from public.student_group_enrollments where center_id = '${CENTER}' and id like 'sge-sab-%';
update public.students set group_id = null, group_name = grade
  where center_id = '${CENTER}' and group_id like 'grp-sab-%';
delete from public.schedule_slots where center_id = '${CENTER}' and id like 'slot-sab-%';
delete from public.groups where center_id = '${CENTER}' and id like 'grp-sab-%';
delete from public.teachers where center_id = '${CENTER}' and id like 'tch-sab-%';
delete from public.accounts where center_id = '${CENTER}' and role = 'teacher' and id like 'acc-sab-tch-%';
drop table if exists import_sabboura.teachers, import_sabboura.rooms, import_sabboura.class_groups,
  import_sabboura.weekly_sessions, import_sabboura.student_group_links;
commit;
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/03-sabboura-timetable.sql`, apply, "utf8");
writeFileSync(`${OUT_DIR}/03-sabboura-timetable-UNDO.sql`, undo, "utf8");
console.log(`OK: ${teachers.length} مدرسين، ${byGroup.size} مجموعة، ${sessions.length} حصة، ${links.length} ربط`);
