/**
 * المالك بيشغّل الملف ده بنفسه: بيسأله عن الإيميل وكلمة السر (كلمة السر مش بتظهر وهو بيكتبها)،
 * وبيكتب ملف SQL فيه حساب مدير المنصة بكلمة سر متشفّرة (PBKDF2) — كلمة السر نفسها مش بتتكتب في أي مكان.
 * مش بيكلّم قاعدة البيانات خالص. المالك هو اللي يلصق الملف في SQL Editor.
 *
 * تشغيل:  bun run scripts/make-platform-owner-sql.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { hashPassword } from "../src/lib/password.server";

const OUT_DIR = "D:/erp Systems/_reports/scholariq-sql";

function ask(question: string): Promise<string> {
  process.stdout.write(question);
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (d) => {
      process.stdin.pause();
      resolve(String(d).trim());
    });
  });
}

function askHidden(question: string): Promise<string> {
  process.stdout.write(question);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") process.exit(1);
        if (ch === "\u0008" || ch === "\u007f") {
          if (value.length) { value = value.slice(0, -1); process.stdout.write("\b \b"); }
          continue;
        }
        value += ch;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;

const email = (await ask("الإيميل اللي هتدخل بيه: ")).toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.log("الإيميل مش مظبوط"); process.exit(1); }
const p1 = await askHidden("كلمة السر (8 حروف على الأقل): ");
if (p1.length < 8) { console.log("كلمة السر قصيرة"); process.exit(1); }
const p2 = await askHidden("اكتبها تاني للتأكيد: ");
if (p1 !== p2) { console.log("الكلمتين مش زي بعض — جرّب تاني"); process.exit(1); }

const hash = await hashPassword(p1);

const apply = `-- حساب مدير المنصة (أول حساب) — منصة السنتر على مشروع The-Educational-Center (kqmjzwtwiuvyjxlksdmf).
-- اتأكد إن الرابط فوق في Supabase فيه kqmjzwtwiuvyjxlksdmf قبل ما تدوس Run.
-- كلمة السر متخزنة متشفّرة بس (password_hash)، ومفيش كلمة سر مكتوبة هنا.
begin;

do $$
begin
  if to_regclass('public.accounts') is null or to_regclass('public.keepalive_log') is null then
    raise exception 'وقف: ده مش مشروع السنتر';
  end if;
  if exists (select 1 from public.accounts where center_id = 'platform') then
    raise exception 'وقف: حساب مدير المنصة موجود قبل كده';
  end if;
end $$;

insert into public.centers (id, name, branch, status, expires_at)
values ('platform', 'إدارة المنصة', '—', 'active', now() + interval '100 years')
on conflict (id) do nothing;

insert into public.accounts (id, center_id, role, full_name, phone, identifier, password, password_hash)
values ('acc-platform-owner', 'platform', 'owner', 'مدير المنصة', null, ${sqlText(email)}, null, ${sqlText(hash)});

select id, center_id, role, identifier, password_hash is not null as has_password from public.accounts where center_id = 'platform';
commit;
`;

const undo = `-- رجوع: يشيل حساب مدير المنصة اللي اتعمل بملف 01 (والسنتر 'platform' لو مالوش حسابات تانية).
begin;
delete from public.accounts where id = 'acc-platform-owner';
delete from public.centers c where c.id = 'platform' and not exists (select 1 from public.accounts a where a.center_id = c.id);
commit;
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/01-platform-owner.sql`, apply, "utf8");
writeFileSync(`${OUT_DIR}/01-platform-owner-UNDO.sql`, undo, "utf8");
console.log(`\nتمام. الملف جاهز: ${OUT_DIR}/01-platform-owner.sql`);
console.log("افتحه، انسخ كله، والصقه في SQL Editor بتاع مشروع The-Educational-Center، ودوس Run.");
process.exit(0);
