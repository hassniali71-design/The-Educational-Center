-- بناء قاعدة منصة السنتر من الصفر على مشروع فاضي — كل الـ migrations من 0001 لـ 0038 بالترتيب الصح.
-- 0026 (إنشاء notifications) اتنقل قبل 0013 اللي بيعدّل عليه. 0039 مش موجود (مفيش باسوردات قديمة).
-- اتعمل تلقائي من supabase/migrations — متعدلش هنا، عدّل الأصل.

-- الحماية: بيرفض يشتغل إلا على مشروع فاضي تماماً (مفيش ولا جدول في public).
-- كله جوه معاملة واحدة: يا يتبني كله، يا ولا حاجة.
begin;

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public') then
    raise exception 'وقف: المشروع ده مش فاضي — الملف ده بيتطبق على مشروع فاضي بس';
  end if;
end $$;


-- ================= 0001_centers_and_accounts.sql =================
-- SUPABASE_MIGRATION_SPEC.md §1-2 — centers (tenants) + accounts (login/session layer).
--
-- Primary keys are TEXT, not native `uuid`. The app's `UUID` TS type (src/types/index.ts)
-- is a plain string alias, not a real UUID format constraint, and every existing seed id
-- ("st-1", "tc-1", "cl-1", "acc-owner"...) plus every runtime id generator in data-store.ts
-- and auth.ts (`` `acc-${Date.now()}` ``, `` `TCH-${2001 + i}` ``, `` `sess-${Date.now()}` ``)
-- produces non-UUID strings. Switching to native `uuid` would require rewriting every id
-- generator across the app just to satisfy a column type, which contradicts §5's "no UI
-- rebuild" and §4's "match every seed value exactly" — so this migration keeps ids as TEXT
-- to preserve 100% fidelity with the existing app instead of the literal "UUID" wording.

create table if not exists centers (
  id text primary key,
  name text not null,
  branch text not null,
  created_at timestamptz not null default now()
);

create table if not exists accounts (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  role text not null check (role in ('owner', 'staff', 'teacher', 'student', 'parent', 'visitor')),
  full_name text not null,
  phone text,
  -- Owner: email. Teacher/Staff: code (e.g. TCH-2001). Student/Parent: student code. Visitor: invite code.
  identifier text not null unique,
  -- Owner / Teacher / Staff only — null for student/parent/visitor (matches auth.ts's Account shape).
  password text,
  created_at timestamptz not null default now()
);

create index if not exists idx_accounts_center_id on accounts (center_id);
create index if not exists idx_accounts_identifier on accounts (identifier);


-- ================= 0002_reference_and_people.sql =================
-- SUPABASE_MIGRATION_SPEC.md §1 — reference tables + core people/group entities.
-- Every table here carries center_id per §1 ("كل الجداول تقريباً، ما عدا جدول centers نفسه").

create table if not exists subjects (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  name text not null,
  theme_key text not null
);
create index if not exists idx_subjects_center_id on subjects (center_id);

create table if not exists grades (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  name text not null,
  "order" integer not null
);
create index if not exists idx_grades_center_id on grades (center_id);

-- Which subjects a grade actually studies (CURRICULUM_ENGINE_SPEC.md §8). No center_id in the
-- TS type itself (`GradeSubject` is a pure grade_id/subject_id pairing) — denormalized here
-- anyway per §1's "نحافظ على نمط center_id في كل كيان" so every table stays directly filterable.
create table if not exists grade_subjects (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  grade_id text not null references grades (id) on delete cascade,
  subject_id text not null references subjects (id) on delete cascade
);
create index if not exists idx_grade_subjects_center_id on grade_subjects (center_id);
create index if not exists idx_grade_subjects_grade_id on grade_subjects (grade_id);
create index if not exists idx_grade_subjects_subject_id on grade_subjects (subject_id);

create table if not exists teachers (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  -- The teacher's auth.ts login identifier (e.g. "TCH-2001") — a join key against
  -- accounts.identifier, not a literal FK column (same mechanism as students.code).
  user_id text,
  full_name text not null,
  subject text not null,
  subject_id text not null references subjects (id) on delete restrict,
  groups integer not null default 0,
  students integer not null default 0,
  timer_compliance integer not null default 0,
  sla_breaches integer not null default 0,
  monthly_revenue numeric not null default 0
);
create index if not exists idx_teachers_center_id on teachers (center_id);
create index if not exists idx_teachers_subject_id on teachers (subject_id);
create index if not exists idx_teachers_user_id on teachers (user_id);

create table if not exists groups (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  name text not null,
  subject text not null,
  subject_id text not null references subjects (id) on delete restrict,
  teacher_name text not null,
  teacher_id text not null references teachers (id) on delete restrict,
  grade text not null,
  grade_id text not null references grades (id) on delete restrict,
  weekday text not null,
  "time" text not null,
  room text not null,
  enrolled integer not null default 0,
  capacity integer not null default 0
);
create index if not exists idx_groups_center_id on groups (center_id);
create index if not exists idx_groups_teacher_id on groups (teacher_id);
create index if not exists idx_groups_subject_id on groups (subject_id);
create index if not exists idx_groups_grade_id on groups (grade_id);

create table if not exists students (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  code text not null unique,
  full_name text not null,
  grade text not null,
  group_name text not null,
  -- Null when the student's group_name has no matching Group record yet (pre-existing seed gap).
  group_id text references groups (id) on delete set null,
  guardian_name text not null,
  guardian_phone text not null,
  payment_status text not null check (payment_status in ('paid', 'pending', 'overdue')),
  balance_due numeric not null default 0,
  points integer not null default 0,
  attendance_rate integer not null default 0,
  avg_score integer not null default 0,
  -- CURRICULUM_ENGINE_SPEC.md §7 — explicit multi-subject enrollment.
  subject_ids text[] not null default '{}'
);
create index if not exists idx_students_center_id on students (center_id);
create index if not exists idx_students_group_id on students (group_id);
create index if not exists idx_students_code on students (code);


-- ================= 0003_curriculum_and_lessons.sql =================
-- SUPABASE_MIGRATION_SPEC.md §1 — curriculum plan + AI-generated lesson content
-- (TEACHER_MODULE_SPEC.md §4-b / CURRICULUM_ENGINE_SPEC.md §8, §13).

create table if not exists lessons (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  group_id text not null references groups (id) on delete cascade,
  subject_id text not null references subjects (id) on delete restrict,
  title text not null,
  source_file_name text,
  extracted_text text,
  content_hash text,
  ai_status text not null check (ai_status in ('idle', 'processing', 'ready', 'failed')),
  ai_error text,
  taught_status text not null check (taught_status in ('not_started', 'in_progress', 'done')),
  taught_at timestamptz,
  actual_duration_seconds integer,
  created_by_teacher_id text not null references teachers (id) on delete restrict
);
create index if not exists idx_lessons_center_id on lessons (center_id);
create index if not exists idx_lessons_group_id on lessons (group_id);
create index if not exists idx_lessons_content_hash on lessons (content_hash);

-- Pre-Phase-2 static slide deck / question bank rows have lesson_id null in the app's own
-- type comments — kept nullable here too, but every *row* still carries a real center_id
-- (this app's seed has no shared cross-tenant demo content; each new client onboarded via
-- §8 starts empty, so there's no reason for these to ever be tenant-less).
create table if not exists lesson_slides (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  lesson_id text references lessons (id) on delete cascade,
  "index" integer not null,
  title text not null,
  bullets text[] not null default '{}'
);
create index if not exists idx_lesson_slides_center_id on lesson_slides (center_id);
create index if not exists idx_lesson_slides_lesson_id on lesson_slides (lesson_id);

-- CURRICULUM_ENGINE_SPEC.md §8 — question variety (mcq/true_false/ordering/matching).
-- `QuizQuestion` is reused verbatim for the in-session random picker AND embedded inside
-- electronic_homeworks.questions (jsonb there, see below) — this table is the picker's bank.
create table if not exists session_questions (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  lesson_id text references lessons (id) on delete cascade,
  source text not null check (source in ('ai_generated', 'manual')),
  kind text not null check (kind in ('mcq', 'true_false', 'ordering', 'matching')),
  text text not null,
  options text[] not null default '{}',
  correct_index integer not null default 0,
  match_targets text[]
);
create index if not exists idx_session_questions_center_id on session_questions (center_id);
create index if not exists idx_session_questions_lesson_id on session_questions (lesson_id);

create table if not exists curriculum_units (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  subject_id text not null references subjects (id) on delete restrict,
  grade_id text not null references grades (id) on delete restrict,
  name text not null,
  "order" integer not null,
  planned_duration_days integer not null default 0
);
create index if not exists idx_curriculum_units_center_id on curriculum_units (center_id);
create index if not exists idx_curriculum_units_subject_id on curriculum_units (subject_id);
create index if not exists idx_curriculum_units_grade_id on curriculum_units (grade_id);

-- No center_id on `CurriculumLesson` in the TS type either — denormalized here too, same
-- reasoning as grade_subjects above.
create table if not exists curriculum_lessons (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  unit_id text not null references curriculum_units (id) on delete cascade,
  "order" integer not null,
  title text not null,
  status text not null check (status in ('not_started', 'in_progress', 'done')),
  linked_lesson_id text references lessons (id) on delete set null
);
create index if not exists idx_curriculum_lessons_center_id on curriculum_lessons (center_id);
create index if not exists idx_curriculum_lessons_unit_id on curriculum_lessons (unit_id);

-- §8 — one suggested activity per lesson, generated by the stub pipeline.
create table if not exists suggested_activities (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  lesson_id text not null references lessons (id) on delete cascade,
  type text not null check (type in ('visit', 'draw', 'observe', 'practice', 'other')),
  title text not null,
  description text not null
);
create index if not exists idx_suggested_activities_center_id on suggested_activities (center_id);
create index if not exists idx_suggested_activities_lesson_id on suggested_activities (lesson_id);

-- `questions` is stored as jsonb (embedding QuizQuestion[] verbatim), matching the TS
-- interface exactly (`ElectronicHomework.questions: QuizQuestion[]` is an embedded array,
-- not a join relation in the app's own model) rather than inventing a new normalized shape.
create table if not exists electronic_homeworks (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  lesson_id text not null references lessons (id) on delete cascade,
  group_id text not null references groups (id) on delete cascade,
  questions jsonb not null default '[]',
  due_at text not null
);
create index if not exists idx_electronic_homeworks_center_id on electronic_homeworks (center_id);
create index if not exists idx_electronic_homeworks_lesson_id on electronic_homeworks (lesson_id);
create index if not exists idx_electronic_homeworks_group_id on electronic_homeworks (group_id);


-- ================= 0004_session_engine.sql =================
-- SUPABASE_MIGRATION_SPEC.md §1 — the "وضع الحصة" session engine
-- (CURRICULUM_ENGINE_SPEC.md §13): one record per taught session + everything
-- logged during it.

create table if not exists session_records (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  group_id text not null references groups (id) on delete cascade,
  lesson_id text references lessons (id) on delete set null,
  teacher_id text not null references teachers (id) on delete restrict,
  date text not null,
  attendees_count integer not null default 0,
  absentees_count integer not null default 0,
  questions_asked_count integer not null default 0,
  participants_count integer not null default 0,
  homework_launch_status text not null check (homework_launch_status in ('not_sent', 'sent')),
  e_homework_launch_status text not null check (e_homework_launch_status in ('not_sent', 'sent')),
  activity_completed_in_session boolean not null default false,
  duration_seconds integer not null default 0,
  explanation_duration_seconds integer not null default 0,
  extension_seconds integer not null default 0,
  general_notes text
);
create index if not exists idx_session_records_center_id on session_records (center_id);
create index if not exists idx_session_records_group_id on session_records (group_id);
create index if not exists idx_session_records_lesson_id on session_records (lesson_id);

create table if not exists session_events (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  session_id text not null references session_records (id) on delete cascade,
  student_id text not null references students (id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('homework_score', 'question_answer', 'activity_score', 'attendance', 'note')),
  payload jsonb not null default '{}'
);
create index if not exists idx_session_events_center_id on session_events (center_id);
create index if not exists idx_session_events_session_id on session_events (session_id);
create index if not exists idx_session_events_student_id on session_events (student_id);

create table if not exists timer_extensions (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  session_id text not null references session_records (id) on delete cascade,
  step_key text not null check (
    step_key in (
      'last_homework', 'lesson', 'questions', 'book_exercise',
      'activity_review', 'release_homework', 'release_e_homework', 'behavior'
    )
  ),
  added_seconds integer not null,
  reason text,
  at timestamptz not null default now()
);
create index if not exists idx_timer_extensions_center_id on timer_extensions (center_id);
create index if not exists idx_timer_extensions_session_id on timer_extensions (session_id);

create table if not exists random_pick_logs (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  group_id text not null references groups (id) on delete cascade,
  student_id text not null references students (id) on delete cascade,
  session_id text not null references session_records (id) on delete cascade,
  picked_at timestamptz not null default now()
);
create index if not exists idx_random_pick_logs_center_id on random_pick_logs (center_id);
create index if not exists idx_random_pick_logs_session_id on random_pick_logs (session_id);
create index if not exists idx_random_pick_logs_group_id on random_pick_logs (group_id);

create table if not exists assessment_scores (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  student_id text not null references students (id) on delete cascade,
  session_id text references session_records (id) on delete set null,
  lesson_id text references lessons (id) on delete set null,
  category text not null check (category in ('homework', 'activity', 'behavior', 'question', 'e_homework')),
  source text not null check (source in ('auto', 'manual')),
  value numeric not null,
  max_value numeric not null,
  recorded_by_teacher_id text not null references teachers (id) on delete restrict,
  recorded_at timestamptz not null default now()
);
create index if not exists idx_assessment_scores_center_id on assessment_scores (center_id);
create index if not exists idx_assessment_scores_student_id on assessment_scores (student_id);
create index if not exists idx_assessment_scores_session_id on assessment_scores (session_id);
create index if not exists idx_assessment_scores_lesson_id on assessment_scores (lesson_id);

-- CURRICULUM_ENGINE_SPEC.md §1 — "حل تمارين الكتاب": same shape used twice per session via
-- `context`, once in-class and once as homework.
create table if not exists book_exercise_tasks (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  session_id text not null references session_records (id) on delete cascade,
  student_group_id text not null references groups (id) on delete cascade,
  pages_text text not null,
  context text not null check (context in ('in_session', 'homework')),
  created_at timestamptz not null default now()
);
create index if not exists idx_book_exercise_tasks_center_id on book_exercise_tasks (center_id);
create index if not exists idx_book_exercise_tasks_session_id on book_exercise_tasks (session_id);


-- ================= 0005_operations.sql =================
-- SUPABASE_MIGRATION_SPEC.md §1 — attendance, money, inventory, and the
-- per-portal (student/parent) entities.

create table if not exists attendance_records (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  student_id text not null references students (id) on delete cascade,
  student_name text not null,
  group_name text not null,
  status text not null check (status in ('present', 'late', 'absent')),
  checked_in_at timestamptz not null default now(),
  method text not null check (method in ('qr', 'barcode', 'manual')),
  -- Session-mode marks link here; QR-gate / legacy check-ins have no session context.
  session_id text references session_records (id) on delete set null
);
create index if not exists idx_attendance_records_center_id on attendance_records (center_id);
create index if not exists idx_attendance_records_student_id on attendance_records (student_id);
create index if not exists idx_attendance_records_session_id on attendance_records (session_id);

create table if not exists payments (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  student_name text not null,
  student_code text not null,
  amount numeric not null,
  method text not null check (method in ('cash', 'wallet', 'instapay')),
  item text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_payments_center_id on payments (center_id);
create index if not exists idx_payments_student_code on payments (student_code);

create table if not exists booklets (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  title text not null,
  subject text not null,
  price numeric not null default 0,
  in_stock integer not null default 0,
  delivered integer not null default 0
);
create index if not exists idx_booklets_center_id on booklets (center_id);

create table if not exists shift_closures (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  expected numeric not null,
  counted numeric not null,
  diff numeric not null,
  closed_at timestamptz not null default now()
);
create index if not exists idx_shift_closures_center_id on shift_closures (center_id);

-- In-session running scoreboard, keyed one row per student, upserted live and cleared when
-- a session ends (data-store.ts resets this to [] on session end — mirrors that here as a
-- delete, not a new "cleared" flag, keeping the table's meaning identical to the TS array).
create table if not exists live_scores (
  student_id text primary key references students (id) on delete cascade,
  center_id text not null references centers (id) on delete cascade,
  student_name text not null,
  homework_score integer,
  question_score integer,
  points integer not null default 0
);
create index if not exists idx_live_scores_center_id on live_scores (center_id);

-- §"leaderboard" (`LeaderboardEntry`) intentionally has NO table: in data-store.ts it is
-- always `buildLeaderboard(students)`, a pure ranking computed from `students.points` at
-- every read — never independently written. Recomputing it from `students` (client-side, or
-- via `order by points desc` in the server function) preserves that exactly; a stored copy
-- would just be a cache that can drift, which the current code never had to worry about.

create table if not exists quiz_results (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  student_id text not null references students (id) on delete cascade,
  subject text not null,
  title text not null,
  date text not null,
  score numeric not null,
  max_score numeric not null
);
create index if not exists idx_quiz_results_center_id on quiz_results (center_id);
create index if not exists idx_quiz_results_student_id on quiz_results (student_id);

create table if not exists homework_tasks (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  student_id text not null references students (id) on delete cascade,
  subject text not null,
  title text not null,
  due_date text not null,
  status text not null check (status in ('pending', 'submitted', 'graded', 'late')),
  grade numeric
);
create index if not exists idx_homework_tasks_center_id on homework_tasks (center_id);
create index if not exists idx_homework_tasks_student_id on homework_tasks (student_id);

create table if not exists whatsapp_logs (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  student_id text not null references students (id) on delete cascade,
  sent_at timestamptz not null default now(),
  template text not null check (template in ('attendance', 'payment', 'grade', 'homework', 'absence')),
  message text not null,
  delivered boolean not null default false
);
create index if not exists idx_whatsapp_logs_center_id on whatsapp_logs (center_id);
create index if not exists idx_whatsapp_logs_student_id on whatsapp_logs (student_id);

create table if not exists teacher_notes (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  student_id text not null references students (id) on delete cascade,
  teacher_id text not null references teachers (id) on delete cascade,
  teacher_name text not null,
  subject text not null,
  date text not null,
  note text not null,
  tone text not null check (tone in ('positive', 'neutral', 'warning'))
);
create index if not exists idx_teacher_notes_center_id on teacher_notes (center_id);
create index if not exists idx_teacher_notes_student_id on teacher_notes (student_id);


-- ================= 0006_fix_display_string_timestamps.sql =================
-- Fix-up migration, discovered while running scripts/seed-supabase.ts against the real data:
-- several "timestamp-looking" fields in src/lib/data-store.ts (`nowTime()` / `todayLabel()`)
-- and their mock-data.ts seed values are actually opaque Arabic display strings
-- ("03:52 م", "اليوم 03:53 م", "أمس 08:10 م"), never real ISO timestamps — unlike
-- accounts.created_at / centers.created_at, which genuinely are `new Date().toISOString()`.
-- 0003/0004/0005 guessed `timestamptz` for these before that was confirmed; correcting here
-- instead of editing already-applied migrations.

alter table attendance_records alter column checked_in_at type text using checked_in_at::text;
alter table attendance_records alter column checked_in_at drop default;

alter table payments alter column created_at type text using created_at::text;
alter table payments alter column created_at drop default;

alter table shift_closures alter column closed_at type text using closed_at::text;
alter table shift_closures alter column closed_at drop default;

alter table whatsapp_logs alter column sent_at type text using sent_at::text;
alter table whatsapp_logs alter column sent_at drop default;

alter table session_events alter column at type text using at::text;
alter table session_events alter column at drop default;

alter table timer_extensions alter column at type text using at::text;
alter table timer_extensions alter column at drop default;

alter table random_pick_logs alter column picked_at type text using picked_at::text;
alter table random_pick_logs alter column picked_at drop default;

alter table assessment_scores alter column recorded_at type text using recorded_at::text;
alter table assessment_scores alter column recorded_at drop default;

alter table book_exercise_tasks alter column created_at type text using created_at::text;
alter table book_exercise_tasks alter column created_at drop default;

alter table lessons alter column taught_at type text using taught_at::text;


-- ================= 0007_tenant_identity.sql =================
-- SUPABASE_MIGRATION_SPEC.md §11-أ/ب — per-client visual identity + a dedicated login link.
-- Both nullable: existing centers get backfilled by a follow-up script (not this migration,
-- which stays pure DDL), and the app falls back to the navy default / no dedicated link when
-- either is unset rather than requiring it.

alter table centers add column if not exists accent_color text;
alter table centers add column if not exists slug text;

-- Partial unique index (not a plain unique constraint) so multiple NULL slugs stay legal
-- during the backfill window instead of erroring the migration.
create unique index if not exists idx_centers_slug on centers (slug) where slug is not null;


-- ================= 0008_client_lifecycle.sql =================
-- PLATFORM_CLIENT_MANAGEMENT_SPEC.md §1 — per-client subscription lifecycle (joined/expiry/
-- active-paused) for the platform admin's "كل العملاء" screen, plus a last-login timestamp on
-- `accounts` so §3-4 ("آخر نشاط") can be rolled up per center without a separate activity log
-- table (small dataset, cheap to compute in the server function — see fetchClients).

alter table centers add column if not exists joined_at timestamptz;
alter table centers add column if not exists expires_at timestamptz;
alter table centers add column if not exists status text not null default 'active' check (status in ('active', 'paused'));

-- §1 backfill: existing centers already have a real `created_at` from migration 0001's
-- `default now()` at insert time, so every current row (including the two isolation-test
-- tenants and "platform") uses that as `joined_at` — the "no real date, use now()" fallback
-- in the spec never actually triggers here, but stays as the coalesce for safety.
update centers set joined_at = coalesce(joined_at, created_at, now()) where joined_at is null;
update centers set expires_at = coalesce(expires_at, joined_at + interval '1 year') where expires_at is null;

alter table centers alter column joined_at set not null;
alter table centers alter column joined_at set default now();
alter table centers alter column expires_at set not null;

alter table accounts add column if not exists last_login_at timestamptz;


-- ================= 0009_owner_control_tower.sql =================
-- Migration 0009: برج تحكم المالك — الجداول الأساسية.
--
-- ملف ثبّت أصلاً في db/0009_owner_control_tower.sql (Lovable كانت قافلة مجلد
-- supabase/migrations وقتها، فاتحط في مجلد db/ منفصل كحل بديل مع تعليمة "شغّله
-- يدوياً في SQL Editor"). هذا الملف ينقله للمكان الصحيح ليكون سجل الهجرات في
-- supabase/migrations/ كاملاً ومطابقاً للترقيم الحقيقي المُشار إليه في تعليقات
-- كود المشروع (Migration 0025 مثلاً بيعدّل على center_finance_settings اللي هنا).
--
-- ملحوظة: جدول notifications كان جزءاً من db/0009 الأصلي، لكن نُقل بالفعل بشكل
-- مستقل في Migration 0026 — لا يتكرر هنا لتفادي التعريف المزدوج.
--
--  1) إعدادات النظام المالي لكل مركز (شهري / بالحصة / بالسيزون) + أساس رواتب الموظفين.
--  2) سجل تسليم واستلام الخزنة (المدير يستلم مبلغ من موظف بتاريخه).
--  3) سجل النشاط الموحّد (Timeline).
--  4) صلاحيات الموظفين التفصيلية.
-- كل الجداول تحمل center_id وتُقرأ/تُكتب عبر نفس طبقة CRUD العامة.

create table if not exists center_finance_settings (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  billing_mode text not null default 'monthly' check (billing_mode in ('monthly', 'per_session', 'season')),
  monthly_fee numeric not null default 0,
  per_session_fee numeric not null default 0,
  season_fee numeric not null default 0,
  season_sessions integer not null default 0,
  staff_salary_basis text not null default 'fixed' check (staff_salary_basis in ('fixed', 'per_session', 'revenue_share')),
  staff_salary_value numeric not null default 0,
  updated_at text not null
);
create unique index if not exists idx_finance_settings_center on center_finance_settings (center_id);

create table if not exists safe_handovers (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  staff_name text not null,
  staff_identifier text,
  amount numeric not null,
  note text,
  received_at text not null,
  created_at text not null
);
create index if not exists idx_safe_handovers_center on safe_handovers (center_id);

create table if not exists activity_log (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  kind text not null,
  title text not null,
  detail text,
  actor text,
  amount numeric,
  created_at text not null
);
create index if not exists idx_activity_log_center on activity_log (center_id);

create table if not exists staff_permissions (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  account_identifier text not null,
  full_name text not null,
  permissions jsonb not null default '[]'::jsonb,
  updated_at text not null
);
create index if not exists idx_staff_permissions_center on staff_permissions (center_id);
create unique index if not exists idx_staff_permissions_account on staff_permissions (account_identifier);


-- ================= 0010_owner_finance_engine.sql =================
-- Migration 0010: محرك ماليات وجدولة المالك — الجداول الأساسية.
--
-- ملف ثبّت أصلاً في db/0010_owner_finance_engine.sql (نفس سبب نقل 0009 — راجع
-- تعليقه). ينقل الجداول للمكان الصحيح في supabase/migrations/.
--
--  1) expenses          — المصروفات العامة (صيانة، فواتير، إيجار...).
--  2) payroll_records   — الرواتب المسجّلة كـ"صادر" حقيقي (مدرس/موظف: بالحصة/أسبوعي/شهري).
--  3) subject_prices    — سعر كل مادة (شهري / بالحصة) يحدده المالك.
--  4) schedule_slots    — غرفة تحكم الجدولة (مدرس × يوم × ساعة × قاعة).

create table if not exists expenses (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  category text not null default 'other',
  title text not null,
  amount numeric not null default 0,
  spent_at text not null,
  note text,
  created_at text not null
);
create index if not exists idx_expenses_center on expenses (center_id);

create table if not exists payroll_records (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  person_type text not null default 'teacher' check (person_type in ('teacher', 'staff')),
  person_id text,
  person_name text not null,
  basis text not null default 'monthly' check (basis in ('per_session', 'weekly', 'monthly')),
  amount numeric not null default 0,
  period text not null,
  paid_at text not null,
  created_at text not null
);
create index if not exists idx_payroll_center on payroll_records (center_id);

create table if not exists subject_prices (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  subject_id text not null,
  subject_name text not null,
  monthly_price numeric not null default 0,
  per_session_price numeric not null default 0,
  updated_at text not null
);
create unique index if not exists idx_subject_prices_unique on subject_prices (center_id, subject_id);

create table if not exists schedule_slots (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  teacher_id text not null,
  teacher_name text not null,
  subject_id text,
  subject text not null default '',
  grade text not null default '',
  weekday text not null,
  time text not null,
  room text not null default '',
  group_id text,
  updated_at text not null
);
create index if not exists idx_schedule_slots_center on schedule_slots (center_id);


-- ================= 0011_student_subject_fees.sql =================
-- Migration 0011: نظام دفع الطالب لكل مادة على حدة.
--
-- ملف ثبّت أصلاً في db/0011_student_subject_fees.sql (نفس سبب نقل 0009/0010 —
-- راجع تعليقهما). النسخة الأصلية كانت بتكرر إنشاء جداول 0010 دفاعياً ("0010 لسه
-- ماتشغّلش")؛ الآن بعد ما 0010 بقى ملف حقيقي في تسلسله الصحيح، الاكتفاء هنا
-- بالإضافة الفعلية الوحيدة لـ 0011: أعمدة جديدة على students.
--
--  * students.billing_plan — نظام دفع الطالب: حصة / شهر / موسم.
--  * students.subject_fees — سعر كل مادة لهذا الطالب تحديداً (jsonb: { subject_id: price }).
--    السعر شخصي لكل طالب (مثال: علوم ٣٠٠، عربي ٤٠٠) وليس سعراً عاماً ثابتاً.

alter table students add column if not exists billing_plan text;
alter table students add column if not exists subject_fees jsonb not null default '{}'::jsonb;


-- ================= 0012_tasks.sql =================
-- 0012_tasks.sql — نظام المهام الموحّد (Tasks)
-- كل مهمة مرتبطة بـ center_id (RLS) + لها مُكلَّف واحد من ثلاث فئات (teacher/staff/owner).
-- المالك يمكنه رؤية كل المهام، الموظف يرى المُكلَّفة له، المدرس يرى المُكلَّفة له.

create table if not exists tasks (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  title text not null,
  task_type text not null default 'general',
  assignee_role text not null check (assignee_role in ('teacher', 'staff', 'owner')),
  assignee_id text,
  assignee_name text not null,
  created_by_id text,
  created_by_name text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  is_urgent boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'cancelled')),
  note text,
  due_at text,
  completed_at text,
  created_at text not null,
  updated_at text not null
);
create index if not exists idx_tasks_center on tasks (center_id);
create index if not exists idx_tasks_assignee on tasks (center_id, assignee_role, assignee_id);
create index if not exists idx_tasks_status on tasks (center_id, status);


-- ================= 0026_create_notifications_table.sql =================
-- Migration 0026: create notifications table in the canonical migrations path.
--
-- db/0009_owner_control_tower.sql already creates it for handoff runs;
-- this file makes the migration history self-contained for supabase/migrations/
-- so 0013_notifications_extension.sql can safely alter it.

create table if not exists notifications (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  kind text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  title text not null,
  body text,
  read_at text,
  created_at text not null
);
create index if not exists idx_notifications_center on notifications (center_id);


-- ================= 0013_notifications_extension.sql =================
-- 0013_notifications_extension.sql — توسيع جدول notifications لربطه بمصدر الحدث.
-- هذا يمكّن النظام من تمييز تنبيه "تأخر المدرس" عن تنبيه "مهمة مستعجلة" بمرونة أكبر.

alter table notifications add column if not exists source_event text;
alter table notifications add column if not exists source_id text;
alter table notifications add column if not exists acknowledged_at text;
alter table notifications add column if not exists is_actionable boolean not null default false;

create index if not exists idx_notifications_source on notifications (center_id, source_event, source_id);


-- ================= 0014_teacher_expected_salary.sql =================
-- 0014_teacher_expected_salary.sql
-- §0.3: راتب المدرس "المتفق عليه" (expected) ≠ "المدفوع فعلياً" (payroll_records).
-- هذا الحقل منفصل تماماً — لا يُخصم من الخزنة ولا يظهر في صافي الربح.

alter table teachers
  add column if not exists expected_salary_basis text
    check (expected_salary_basis in ('per_session', 'weekly', 'monthly'));

alter table teachers
  add column if not exists expected_salary_value numeric not null default 0;


-- ================= 0015_payment_methods_extension.sql =================
-- 0015_payment_methods_extension.sql
-- Section 2 (cashier) — extend payments.method CHECK + attendance_records.late_minutes/locked

alter table payments drop constraint if exists payments_method_check;
alter table payments add constraint payments_method_check
  check (method in ('cash', 'wallet', 'instapay', 'bank_transfer', 'fawry'));

alter table attendance_records
  add column if not exists late_minutes integer not null default 0,
  add column if not exists locked boolean not null default false;


-- ================= 0016_booklets_extension.sql =================
-- 0016_booklets_extension.sql
-- Section 3 — extend booklets with kind, page_count, printed, paper_per_unit

alter table booklets
  add column if not exists kind text not null default 'booklet'
    check (kind in ('book', 'booklet', 'exam')),
  add column if not exists page_count integer not null default 0,
  add column if not exists printed integer not null default 0,
  add column if not exists paper_per_unit integer not null default 1;


-- ================= 0017_paper_credits.sql =================
-- 0017_paper_credits.sql
-- Section 3 — paper credits & transactions for booklet/print accounting

create table if not exists paper_credits (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  staff_id text not null,
  staff_name text not null,
  total_sheets integer not null,
  unit_price numeric not null,
  issued_at text not null,
  note text,
  created_at text not null
);
create index if not exists idx_paper_credits_center on paper_credits (center_id, staff_id);

create table if not exists paper_transactions (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  staff_id text not null,
  staff_name text not null,
  delta_sheets integer not null,
  reason text not null,
  related_booklet_id text,
  related_sale_id text,
  created_at text not null
);
create index if not exists idx_paper_transactions_staff on paper_transactions (center_id, staff_id, created_at desc);


-- ================= 0018_booklet_sales.sql =================
-- 0018_booklet_sales.sql
-- Section 3 — sales of booklets/books/exams to students

create table if not exists booklet_sales (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  student_id text not null references students (id) on delete cascade,
  student_name text not null,
  student_code text not null,
  booklet_id text not null references booklets (id) on delete restrict,
  booklet_title text not null,
  quantity integer not null,
  unit_price numeric not null,
  total_amount numeric not null,
  paper_consumed integer not null,
  sold_by text not null,
  sold_at text not null
);
create index if not exists idx_booklet_sales_center on booklet_sales (center_id, sold_at desc);
create index if not exists idx_booklet_sales_student on booklet_sales (center_id, student_id);


-- ================= 0019_teacher_planning.sql =================
-- 0019_teacher_planning.sql
-- Section 1 (teacher identity) + Section 6 (lesson plans) + platform teacher notes (Mukawala)
-- ملاحظة: لا نحذف أي عمود قديم — كل إضافة nullable / default آمن على بيانات قائمة.

-- 1) توسعة teachers — honorific + صورة غلاف
alter table teachers
  add column if not exists honorific text not null default 'mr'
    check (honorific in ('mr', 'miss', 'mrs')),
  add column if not exists cover_image_key text;

-- 2) خطط الدروس (teacher-owned — منفصلة تماماً عن tasks و lessons)
create table if not exists lesson_plans (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  teacher_id text not null references teachers (id) on delete cascade,
  group_id text not null references groups (id) on delete cascade,
  lesson_name text not null,
  unit text,
  notes text,
  prepared_at text,
  prepared_done boolean not null default false,
  taught_at text,
  taught_done boolean not null default false,
  created_at text not null,
  updated_at text not null
);
create index if not exists idx_lesson_plans_teacher
  on lesson_plans (center_id, teacher_id, group_id, created_at desc);
create index if not exists idx_lesson_plans_group
  on lesson_plans (center_id, group_id);
create index if not exists idx_lesson_plans_unit
  on lesson_plans (center_id, teacher_id, unit);

-- 3) رسائل مدير المنصة للمدرسين (Mukawala) — بدون center_id (عبر كل المراكز)
create table if not exists platform_teacher_notes (
  id text primary key,
  subject_id text not null references subjects (id) on delete cascade,
  body text not null,
  author_identifier text not null,
  author_name text not null,
  created_at text not null,
  updated_at text not null
);
create index if not exists idx_platform_teacher_notes_subject
  on platform_teacher_notes (subject_id, created_at desc);


-- ================= 0020_groups_real_source.sql =================
-- 0020_groups_real_source.sql
-- تحويل `groups` إلى المصدر الوحيد الحقيقي، مع حقل جديد لتتبّع "بانتظار الجدولة".
-- ملاحظة: لا نحذف أي عمود قديم — كل إضافة nullable / default آمن على بيانات قائمة.

alter table groups
  add column if not exists scheduling_status text not null default 'pending'
    check (scheduling_status in ('pending', 'scheduled')),
  add column if not exists created_at text not null default (now()::text),
  add column if not exists notes text;

-- Index للاستعلامات المتكررة (real source: students / owner.index / etc.).
create index if not exists idx_groups_grade_subject
  on groups (center_id, grade_id, subject_id);
create index if not exists idx_groups_status
  on groups (center_id, scheduling_status);


-- ================= 0021_teachers_subject_nullable.sql =================
-- 0021_teachers_subject_nullable.sql
-- إصلاح: teachers.subject_id و teachers.subject كانا NOT NULL مما يمنع إنشاء مدرس
-- بدون اختيار مادة (مثلاً: مدرس متعدد مواد، أو المدرس يُنشأ أولاً ثم تُربط المادة بعد ذلك).
-- تخفيف القيد إلى NULL + default '' لـ subject — آمن على البيانات القائمة (لا حذف، لا إعادة تسمية).

alter table teachers
  alter column subject_id drop not null,
  alter column subject drop not null,
  alter column subject set default '';

-- Index يبقى كما هو — Supabase يقبل NULL في indexed column بدون مشاكل.


-- ================= 0022_groups_teacher_user_id_and_billing.sql =================
-- Migration 0022: groups.teacher_user_id + Student billing mode + monthly_closings
--
-- Section 0: `teacher_user_id` is the secondary join key between `groups` and
-- `teachers`. `groups.teacher_id` (legacy) carries the client-minted id; on
-- Supabase bootstrap, the server replaces the Teacher record with a
-- server-minted id and the old Group rows become orphaned. Storing the
-- `user_id` (the login identifier) is invariant across the bootstrap and
-- gives a belt-and-suspenders join.
--
-- Section 1.21: Student billing mode. Defaults to 'monthly' so existing data
-- is preserved. `due_day_of_month` is only meaningful for monthly billing;
-- null when billing_mode = 'per_session' (then the due date is derived from
-- the group's weekday).
--
-- Section 1.14: `monthly_closings` snapshot table for the "إغلاق شهري"
-- feature on the owner treasury page.

alter table public.groups
  add column if not exists teacher_user_id text null;

create index if not exists groups_teacher_user_id_idx
  on public.groups (teacher_user_id)
  where teacher_user_id is not null;

alter table public.students
  add column if not exists billing_mode text not null default 'monthly'
    check (billing_mode in ('monthly', 'per_session'));

alter table public.students
  add column if not exists due_day_of_month integer null
    check (due_day_of_month is null or (due_day_of_month between 1 and 28));

create table if not exists public.monthly_closings (
  id text primary key,
  center_id text not null references public.centers (id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),
  revenue numeric(12, 2) not null default 0,
  expenses numeric(12, 2) not null default 0,
  salaries numeric(12, 2) not null default 0,
  net numeric(12, 2) not null default 0,
  closed_at timestamptz not null default now(),
  closed_by text null references public.accounts (id) on delete set null,
  unique (center_id, year, month)
);

create index if not exists monthly_closings_center_year_idx
  on public.monthly_closings (center_id, year desc, month desc);

comment on column public.groups.teacher_user_id is
  'Secondary join key to teachers.user_id (login identifier). Survives client/server id divergence on Supabase bootstrap. See plan 1788550279310 §0 cause A.';
comment on column public.students.billing_mode is
  'monthly = charged on a fixed day each month; per_session = charged per attended session (due day derived from group weekday).';
comment on column public.students.due_day_of_month is
  'Only used when billing_mode = monthly. Constrained to 1..28 to be valid in every month. Null for per_session billing.';


-- ================= 0023_teacher_resources_and_launches.sql =================
-- Migration 0023: group_resources + teacher_launches + homework_attempts
-- Plan 1788573108220 (المرحلة A — الموارد + الإطلاق + سجل الحضور).
--
-- كل الـ IDs نصية (`text primary key`) متّسقة مع 0001..0022 — التطبيق يصدرها
-- كـ `tc-${Date.now()}` ولا نعتمد على `gen_random_uuid()`.
--
-- 1) موارد المجموعة (روابط شرح، PDF، روابط خارجية، فيديو)
create table if not exists group_resources (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  group_id text not null references groups (id) on delete cascade,
  resource_type text not null check (resource_type in ('lesson_url','pdf','external_link','video','other')),
  url text not null,
  name text not null,
  unit text null,
  created_by text not null references accounts (id),
  created_at timestamptz not null default now()
);
create index if not exists group_resources_group_idx
  on group_resources (group_id, created_at desc);

-- 2) الإطلاقات (مهام، واجبات، أنشطة، اختبارات تفاعلية)
create table if not exists teacher_launches (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  group_id text not null references groups (id) on delete cascade,
  teacher_id text not null references accounts (id),
  launch_type text not null check (launch_type in (
    'homework','homework_with_correction','in_class_task',
    'interactive_activity','online_homework','online_quiz',
    'reading_assignment','oral_recitation'
  )),
  title text not null,
  body text null,
  notes text null,
  due_at timestamptz null,
  duration_min integer null,
  source_launch_id text null,
  created_at timestamptz not null default now()
);
create index if not exists teacher_launches_group_idx
  on teacher_launches (group_id, created_at desc);
create index if not exists teacher_launches_teacher_idx
  on teacher_launches (teacher_id, created_at desc);

-- 3) محاولات الطلاب على الواجبات الإلكترونية
create table if not exists homework_attempts (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  launch_id text not null references teacher_launches (id) on delete cascade,
  student_id text not null references students (id) on delete cascade,
  student_name text not null,
  answer text null,
  score numeric(5,2) null,
  max_score numeric(5,2) null,
  submitted_at timestamptz not null default now(),
  unique (launch_id, student_id)
);
create index if not exists homework_attempts_launch_idx
  on homework_attempts (launch_id);

comment on table group_resources is
  'روابط شرح / PDF / مرفقات المدرس للمجموعة (Migration 0023, المرحلة A).';
comment on table teacher_launches is
  'إطلاقات المدرس: واجبات، أنشطة، اختبارات تفاعلية، مراجعات (Migration 0023, المرحلة A).';
comment on table homework_attempts is
  'محاولات الطلاب على الواجبات الإلكترونية الصادرة من teacher_launches (Migration 0023, المرحلة A).';


-- ================= 0024_teacher_launches_file_data.sql =================
-- Migration 0024: teacher_launches.file_data (مراجعات/قراءة/ملحقات base64)
-- Migration 0023 / خطة C (C7): المدرس يرفع PDF/صور/مستندات لقراءة الطلاب.
-- نخزّن base64 داخل العمود لتفادي إعداد Supabase Storage bucket منفصل
-- (يمكن لاحقاً نقله لـ Storage بدون تغيير في الـ schema العام).

alter table public.teacher_launches
  add column if not exists file_data text null,
  add column if not exists file_name text null,
  add column if not exists file_mime text null;

comment on column public.teacher_launches.file_data is
  'محتوى الملف (base64) للمراجعات/القراءة — Migration 0024 (المرحلة C).';
comment on column public.teacher_launches.file_name is
  'اسم الملف الأصلي — Migration 0024.';
comment on column public.teacher_launches.file_mime is
  'نوع MIME — Migration 0024.';


-- ================= 0025_fix_schema_contradictions.sql =================
-- Migration 0025: fix-up for the two schema contradictions found in the live-DB audit.
--
-- CD1 — teachers.stages / teachers.primary_stage: declared in the TS `Teacher` type
--       (src/types/index.ts:101-103), written by createTeacherRecord
--       (src/lib/data-store.ts:778-779) and seeded in mock-data.ts:209-210, but no earlier
--       migration ever added them — withColumnFallback silently dropped the columns on every
--       insert (data-functions.server.ts:367), so a teacher's المراحل was never persisted.
--       Using the app's text[] convention (subject_ids in migration 0002, bullets/options in
--       0003).
-- CD2 — center_finance_settings.default_group_capacity: written by saveFinanceSettings via
--       DEFAULT_FINANCE_SETTINGS (data-store.ts:2872, default 20) and rendered by the owner
--       finance UI, but db/0009's table definition has no such column — silently dropped too.

alter table public.teachers
  add column if not exists stages text[] not null default '{primary}';
alter table public.teachers
  add column if not exists primary_stage text not null default 'primary';

alter table public.center_finance_settings
  add column if not exists default_group_capacity integer not null default 20;

comment on column public.teachers.stages is
  'المراحل التي يدرّسها المدرس (ابتدائي/إعدادي/ثانوي) — Migration 0025.';
comment on column public.teachers.primary_stage is
  'أول مرحلة رئيسية (fallback في الـ UI) — Migration 0025.';
comment on column public.center_finance_settings.default_group_capacity is
  'السعة الافتراضية للمجموعة الجديدة (20 افتراضياً) — Migration 0025.';

-- ================= 0028_student_avatar.sql =================
-- Migration 0028: students.avatar_data (صورة بروفايل الطالب)
-- نخزّن base64 داخل العمود، بنفس نمط teacher_launches.file_data (Migration 0024) —
-- تفادياً لإعداد Supabase Storage bucket منفصل الآن (يمكن نقلها لاحقاً بدون تغيير schema عام).

alter table public.students
  add column if not exists avatar_data text null,
  add column if not exists avatar_mime text null;

comment on column public.students.avatar_data is
  'صورة بروفايل الطالب (base64) — Migration 0028.';
comment on column public.students.avatar_mime is
  'نوع MIME لصورة البروفايل — Migration 0028.';


-- ================= 0029_group_activations.sql =================
-- 0029_group_activations.sql — إشارة "المجموعة نشطة الآن" مستقلة تماماً عن
-- sessionRecords/attendanceRecords (فصل زر بدء الحصة عند المدرس عن المجموعات
-- النشطة عند المالك — حصراً فعل الموظف: بوابة الحضور أو زر بدء الحصة).

create table if not exists group_activations (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  group_id text not null,
  activated_at text not null
);
create index if not exists idx_group_activations_center on group_activations (center_id);
create index if not exists idx_group_activations_group on group_activations (group_id, activated_at);


-- ================= 0030_student_group_enrollments.sql =================
-- 0030_student_group_enrollments.sql — تسجيل الطالب في مجموعات إضافية (مواد
-- تانية)، منفصل تماماً عن students.group_id (المجموعة الأساسية القديمة اللي
-- كل الحضور/المدفوعات/وضع الحصة معتمدين عليها بلا أي تغيير). إضافي بحت لدعم
-- صفحة "مدرّسيني ومنهجي" — طالب واحد يقدر يكون في أكتر من مجموعة/مدرس.

create table if not exists student_group_enrollments (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  student_id text not null,
  group_id text not null,
  unique (student_id, group_id)
);
create index if not exists idx_sge_center on student_group_enrollments (center_id);
create index if not exists idx_sge_student on student_group_enrollments (student_id);


-- ================= 0031_fix_session_engine_live_errors.sql =================
-- Migration 0031: إصلاح قيدين حقيقيين اكتشفناهم من أخطاء Supabase الفعلية في الإنتاج
-- (Console errors أثناء استخدام "وضع الحصة" على بيانات حقيقية):
--
-- 1) teacher_launches.teacher_id كان يشاور على accounts(id) (Migration 0023)، لكن
--    كل الكود في المشروع (LaunchPanel, teacher.session.$groupId.tsx) يمرّر
--    group.teacher_id — وهذا فعلياً Teacher.id (مساحة "tc-..."), مش accounts.id
--    (مساحة "acc-..."). النتيجة: كل إطلاق مهمة/واجب من المدرس كان يفشل حفظه فعلياً
--    (foreign key violation "teacher_launches_teacher_id_fkey")، فالطالب ما كانش
--    بيستقبل حاجة أبداً رغم ظهورها للمدرس محلياً. نصحّح الـ FK ليطابق نفس النمط
--    المستخدم في باقي جداول محرك الحصة (session_records.teacher_id،
--    assessment_scores.recorded_by_teacher_id) اللي بيشاوروا صح على teachers(id).
alter table teacher_launches drop constraint if exists teacher_launches_teacher_id_fkey;
alter table teacher_launches
  add constraint teacher_launches_teacher_id_fkey
  foreign key (teacher_id) references teachers (id) on delete restrict;

-- 2) assessment_scores.category CHECK (Migration 0004) كانت ناقصة القيمة 'other'،
--    رغم إن النوع في types/index.ts:481 يسمح بيها من الأساس، ورغم إن
--    src/components/teacher/ExamsCard.tsx يسجّل درجات الامتحانات بهذه الفئة —
--    فأي محاولة تسجيل درجة امتحان كانت تفشل (check constraint violation).
alter table assessment_scores drop constraint if exists assessment_scores_category_check;
alter table assessment_scores
  add constraint assessment_scores_category_check
  check (category in ('homework', 'activity', 'behavior', 'question', 'e_homework', 'other'));


-- ================= 0032_teacher_avatar.sql =================
-- Migration 0032: teachers.avatar_data (صورة بروفايل المدرس)
-- نفس نمط students.avatar_data (Migration 0028) — base64 داخل العمود.

alter table public.teachers
  add column if not exists avatar_data text null,
  add column if not exists avatar_mime text null;

comment on column public.teachers.avatar_data is
  'صورة بروفايل المدرس (base64) — Migration 0032.';
comment on column public.teachers.avatar_mime is
  'نوع MIME لصورة بروفايل المدرس — Migration 0032.';


-- ================= 0033_subject_quotes.sql =================
-- Migration 0033: subject_quotes — عبارات المواد القابلة للتعديل والإطلاق من المالك.
-- بديل قابل للتعديل لبنك الاقتباسات الثابت في src/lib/daily-quotes.ts: المالك يضيف
-- عبارات لكل مادة، ويطلق واحدة منها لتظهر في "غرفة المادة" عند المدرس بدل الاقتباس
-- الثابت. عبارة واحدة فقط نشطة لكل مادة في نفس اللحظة (is_active).

create table if not exists public.subject_quotes (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  subject_id text not null references subjects (id) on delete cascade,
  text text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists subject_quotes_subject_idx
  on public.subject_quotes (subject_id, is_active);

comment on table public.subject_quotes is
  'عبارات/اقتباسات لكل مادة يديرها المالك — Migration 0033. is_active = العبارة المُطلَقة حالياً لهذه المادة.';


-- ================= 0034_whatsapp_template_award_alert.sql =================
-- Migration 0034: whatsapp_logs.template CHECK كان ناقص 'award' و'alert'.
-- src/types/index.ts's WhatsAppLog.template يسمح بالقيمتين من قبل (توسّع النوع بدون
-- تحديث القيد الحقيقي في القاعدة) — نفس فئة الخطأ المُصلَحة في Migration 0031
-- (assessment_scores.category) قبل ما تتسبب في فشل حفظ حقيقي.

alter table public.whatsapp_logs drop constraint if exists whatsapp_logs_template_check;
alter table public.whatsapp_logs
  add constraint whatsapp_logs_template_check
  check (template in ('attendance', 'payment', 'grade', 'homework', 'absence', 'award', 'alert'));


-- ================= 0035_launch_views.sql =================
-- Migration 0035: launch_views — تعليم "اطلعت عليه" من الطالب على إطلاق المدرس.
-- منفصل تماماً عن homework_attempts (التسليم الفعلي) عشان "الاطلاع" لا يُحسَب
-- تلقائياً كـ"تسليم" — إشارة خفيفة بس إن الطالب شاف المهمة.

create table if not exists public.launch_views (
  id text primary key,
  center_id text not null references centers (id) on delete cascade,
  launch_id text not null references teacher_launches (id) on delete cascade,
  student_id text not null references students (id) on delete cascade,
  seen_at timestamptz not null default now(),
  unique (launch_id, student_id)
);
create index if not exists launch_views_launch_idx on public.launch_views (launch_id);

comment on table public.launch_views is
  'تعليم "اطلعت عليه" من الطالب على إطلاق مدرس — Migration 0035، منفصل عن التسليم الفعلي.';


-- ================= 0036_whatsapp_log_teacher_attribution.sql =================
-- Migration 0036: نسب مرسل الرسالة (المدرس) على whatsapp_logs.
-- كان جدول whatsapp_logs بيسجّل رسالة الوسام/التنبيه اللي بيبعتها المدرس
-- (sendTeacherMessage) من غير أي عمود يحفظ *مين* بعتها — يعني مستحيل نعرف
-- أي مدرس أصدر الوسام/التنبيه، رغم إن ده مطلوب صراحة يظهر عند الطالب وولي
-- الأمر. العمودين اختياريان (nullable) لأن باقي أنواع الرسائل (حضور/دفع/
-- درجة/واجب/غياب) بتتولّد آلياً من النظام نفسه بلا مدرس مُصدِر.

alter table whatsapp_logs add column if not exists teacher_id text references teachers (id) on delete set null;
alter table whatsapp_logs add column if not exists teacher_name text;

create index if not exists idx_whatsapp_logs_teacher_id on whatsapp_logs (teacher_id);


-- ================= 0037_fix_group_resources_created_by_fk.sql =================
-- Migration 0037: إصلاح FK خاطئ في group_resources.created_by — نفس باغ migration
-- 0031 بالضبط (teacher_launches.teacher_id) لكنه لم يُصلَح هناك.
--
-- group_resources.created_by (Migration 0023) كان يشاور على accounts(id)، لكن
-- الكود الفعلي (GroupResourcesPanel.tsx → addGroupResource) كان يمرّر
-- `teacherIdentifier` (= session.identifier / Teacher.user_id، مساحة "TCH-...")
-- وهو accounts.identifier لا accounts.id (مساحة "acc-..."). النتيجة: كل حفظ
-- رابط شرح/PDF/فيديو من المدرس كان يفشل فعلياً على قاعدة البيانات (foreign key
-- violation "group_resources_created_by_fkey") بينما الواجهة تعرضه محلياً
-- بشكل متفائل قبل أي رد من الخادم — فيظهر الرابط لحظياً ثم يختفي عند أي
-- تحديث لاحق للبيانات من الخادم (الرابط لم يُحفَظ فعلياً، فلا يتزامن مع الطالب
-- أبداً). نصحّح الـ FK ليطابق نفس النمط المستخدم في باقي جداول محرك الحصة
-- (session_records.teacher_id، assessment_scores.recorded_by_teacher_id،
-- teacher_launches.teacher_id بعد إصلاحها في migration 0031) — كلها تشاور صح
-- على teachers(id). الكود المقابل (src/components/teacher/GroupResourcesPanel.tsx)
-- يمرّر الآن `teacherId` (Teacher.id الحقيقي) بدل `teacherIdentifier`.
alter table group_resources drop constraint if exists group_resources_created_by_fkey;
alter table group_resources
  add constraint group_resources_created_by_fkey
  foreign key (created_by) references teachers (id) on delete restrict;


-- ================= 0038_account_password_hash.sql =================
-- Migration 0038: SECURITY FIX — add accounts.password_hash (PBKDF2-SHA256), stop storing
-- plaintext passwords going forward.
--
-- This migration ONLY adds a nullable column. It does NOT touch, migrate, or drop the
-- existing `password` column — existing plaintext passwords keep working as a fallback.
-- The server (src/lib/auth-functions.server.ts's `signIn`) upgrades each account from
-- plaintext to `password_hash` the next time that account logs in successfully. `password`
-- is deliberately left untouched when that happens — a one-week rollback-safety window,
-- requested explicitly — even though every comparison from that point on prefers
-- `password_hash` and no server function ever returns `password` to a client regardless.
-- See migration 0039 (run separately, later, once that window closes) for clearing it.
-- This migration alone does not retroactively hash every existing password (that requires
-- knowing the plaintext, which only happens at login time).
--
-- Safe to run on the live database: additive only, no existing column/constraint changed,
-- no rows rewritten.

alter table accounts add column if not exists password_hash text;

commit;
