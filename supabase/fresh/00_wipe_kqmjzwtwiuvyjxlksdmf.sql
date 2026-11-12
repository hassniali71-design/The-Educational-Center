-- مسح كامل لمشروع تجربة سفرة (kqmjzwtwiuvyjxlksdmf) قبل بناء منصة السنتر عليه.
-- النسخة الاحتياطية: D:\erp Systems\سفرة-نسخة-مشروع-التجربة-20261112-0307\
--
-- الحماية: الأوامر بترفض تشتغل لو مش لاقية جدول العلامة اللي اتحط في المشروع ده بس.
-- لو اتلصقت بالغلط في أي مشروع تاني، هتقف من أول سطر ومش هتمسح حاجة.
-- كله جوه معاملة واحدة: يا يتمسح كله، يا ولا حاجة.

begin;

do $$
begin
  if not exists (
    select 1 from public._wipe_guard_kqmjzwtwiuvyjxlksdmf where ref = 'kqmjzwtwiuvyjxlksdmf'
  ) then
    raise exception 'وقف: ده مش مشروع تجربة سفرة kqmjzwtwiuvyjxlksdmf';
  end if;
end $$;

-- ١) كل الجداول والبيانات والدوال والـ triggers والأنواع
drop schema public cascade;
create schema public;

-- نفس الصلاحيات الافتراضية بتاعة أي مشروع Supabase جديد
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
alter default privileges in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;

-- ٢) حسابات الدخول (بتمسح معاها الربط والجلسات)
delete from auth.users;

-- ٣) سجل التحديثات القديم
delete from supabase_migrations.schema_migrations;

commit;
