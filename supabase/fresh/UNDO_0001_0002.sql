-- تراجع عن 0001_init_all.sql و 0002_lockdown_and_keepalive.sql: يرجّع المشروع فاضي زي ما كان بعد المسح.
-- خاص بمشروع kqmjzwtwiuvyjxlksdmf بس. الحماية: بيرفض يشتغل لو مش لاقي جدول centers
-- وجدول keepalive_log مع بعض (توقيع قاعدة السنتر)، أو لو فيه جدول من جداول سفرة/دكانة.

begin;

do $$
begin
  if to_regclass('public.centers') is null or to_regclass('public.keepalive_log') is null then
    raise exception 'وقف: دي مش قاعدة منصة السنتر';
  end if;
  if to_regclass('public.orders') is not null or to_regclass('public.restaurant_tables') is not null then
    raise exception 'وقف: فيه جداول سفرة/دكانة هنا — ده مشروع غلط';
  end if;
end $$;

drop schema public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
alter default privileges in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;

commit;
