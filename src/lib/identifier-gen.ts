/**
 * توليد أكواد دخول بسيطة قابلة للقراءة (بدل أرقام عشوائية بحتة) — بطلب صريح من
 * صاحب المشروع لمرحلة التجربة الحالية: PREFIX-XXXX حيث XXXX = حرفان من الاسم
 * الأول + حرفان من اسم الأب، بدل أرقام عشوائية غير مرتبطة بهوية الشخص.
 *
 * ⚠️ ملاحظة أمان مسجَّلة عمداً (مش نسيان): الكود ده أسهل تخميناً بكثير من
 * الكود الرقمي القديم — قرار مقصود لمرحلة التجربة فقط، ومُسجَّل كبند ضمن
 * "بند الأمان الكبير" المؤجل في report.md (مع تشفير كلمات السر و RLS).
 *
 * لا يُستخدم لحساب المالك العام للمنصة (platform admin) — ده بيفضل زي ما هو.
 */

/** تحويل تقريبي لحروف عربية شائعة لحروف لاتينية — مش نطق دقيق، فقط كود قصير مقروء. */
const ARABIC_TO_LATIN: Record<string, string> = {
  ا: "A",
  أ: "A",
  إ: "A",
  آ: "A",
  ء: "A",
  ب: "B",
  ت: "T",
  ث: "T",
  ج: "G",
  ح: "H",
  خ: "K",
  د: "D",
  ذ: "D",
  ر: "R",
  ز: "Z",
  س: "S",
  ش: "S",
  ص: "S",
  ض: "D",
  ط: "T",
  ظ: "Z",
  ع: "A",
  غ: "G",
  ف: "F",
  ق: "Q",
  ك: "K",
  ل: "L",
  م: "M",
  ن: "N",
  ه: "H",
  ة: "H",
  و: "W",
  ي: "Y",
  ى: "Y",
};

/** يحوّل كلمة (عربية أو لاتينية) لأول حرفين لاتينيين صالحين لكود الدخول. */
function firstTwoLatinLetters(word: string): string {
  const letters: string[] = [];
  for (const ch of word) {
    if (letters.length >= 2) break;
    if (/[a-zA-Z]/.test(ch)) {
      letters.push(ch.toUpperCase());
      continue;
    }
    const mapped = ARABIC_TO_LATIN[ch];
    if (mapped) letters.push(mapped);
  }
  while (letters.length < 2) letters.push("X");
  return letters.join("");
}

/** حرفان من الاسم الأول + حرفان من اسم الأب (الكلمة الثانية من الاسم الكامل). */
export function buildNameCode(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? "";
  const father = words[1] ?? words[0] ?? "";
  return `${firstTwoLatinLetters(first)}${firstTwoLatinLetters(father)}`;
}

/**
 * يبني كود دخول فريد بصيغة PREFIX-XXXX، ويزود رقماً في الآخر (XXXX2, XXXX3...)
 * لو الكود الأساسي متكرر بالفعل. `isTaken` بيتحقق من التكرار (globally
 * unique زي accounts.identifier الحالي في قاعدة البيانات).
 */
export function generateFriendlyIdentifier(
  prefix: string,
  fullName: string,
  isTaken: (candidate: string) => boolean,
): string {
  const base = buildNameCode(fullName);
  let candidate = `${prefix}-${base}`;
  let attempt = 2;
  while (isTaken(candidate)) {
    candidate = `${prefix}-${base}${attempt}`;
    attempt += 1;
  }
  return candidate;
}

/** كلمة سر بسيطة: 4 أرقام عشوائية — بنفس الطلب الصريح لمرحلة التجربة. */
export function generateSimplePassword(): string {
  let out = "";
  for (let i = 0; i < 4; i += 1) out += Math.floor(Math.random() * 10);
  return out;
}

/**
 * كود الدخول الرقمي — طلب صريح من صاحب المشروع (12/11/2026): رقمين بيحددوا نوع الحساب
 * (صفحة اليوزر) + 6 أرقام عشوائية بتحدد الشخص نفسه. 8 أرقام إجمالاً، من غير كلمة سر.
 * ولي الأمر بيدخل بكود ابنه (20…). مالك السنتر ومدير المنصة مستثنيين (كود/إيميل + كلمة سر).
 */
export const ROLE_CODE_PREFIX = {
  staff: "10",
  student: "20",
  teacher: "30",
  visitor: "40",
} as const;

export type CodeLoginRole = keyof typeof ROLE_CODE_PREFIX;

/** crypto.getRandomValues شغال في Cloudflare Workers وفي Node/Bun. */
export function generateRoleLoginCode(role: CodeLoginRole): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return ROLE_CODE_PREFIX[role] + String(buf[0]! % 1_000_000).padStart(6, "0");
}

/** بيحوّل الأرقام العربية/الفارسية لإنجليزي ويشيل المسافات؛ بيرجّع null لو مش 8 أرقام. */
export function normalizeRoleLoginCode(input: string): string | null {
  const ascii = input
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s-]+/g, "");
  return /^\d{8}$/.test(ascii) ? ascii : null;
}

export const ROLE_PREFIX = {
  owner: "OWN",
  teacher: "TCH",
  staff: "STF",
  student: "STD",
} as const;
