-- 0002: قفل الجداول + جدول منع الإيقاف. بيتطبق بعد 0001_init_all.sql مباشرة.
--
-- التطبيق بيكلّم القاعدة من السيرفر بس، بمفتاح service_role (src/lib/supabase-server.ts)،
-- والمفتاح ده بيعدّي فوق RLS. يعني قفل الجداول هنا مش بيأثر على التطبيق خالص، بس بيمنع
-- أي حد معاه المفتاح العام (anon) إنه يقرا أو يكتب أي حاجة مباشرة.

begin;

do $$
begin
  if to_regclass('public.centers') is null or to_regclass('public.accounts') is null then
    raise exception 'وقف: طبّق 0001_init_all.sql الأول';
  end if;
  if to_regclass('public.orders') is not null or to_regclass('public.restaurant_tables') is not null then
    raise exception 'وقف: فيه جداول سفرة/دكانة هنا — ده مشروع غلط';
  end if;
end $$;

-- جدول منع الإيقاف: كل نبضة من /api/health بتكتب فيه سطر.
create table if not exists public.keepalive_log (
  id bigint generated always as identity primary key,
  source text not null,
  pinged_at timestamptz not null default now()
);
create index if not exists idx_keepalive_log_pinged_at on public.keepalive_log (pinged_at desc);

-- تشغيل RLS على كل جداول public من غير أي سياسات = مقفولة على anon/authenticated.
do $$
declare
  r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- وسحب الصلاحيات من الأدوار العامة كطبقة تانية.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

commit;
