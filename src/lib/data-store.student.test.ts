import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

/**
 * data-store.ts's `readState()` deliberately returns a fixed SSR placeholder whenever
 * `typeof window === "undefined"` (so server-rendered requests never see another request's
 * mutated cache) — correct for production, but it means the module's real (cache-backed)
 * behavior cannot be exercised headlessly without something resembling `window`. This stub
 * is test-only scaffolding (no new dependency, nothing shipped) that satisfies exactly the
 * globals data-store.ts actually touches, so `createStudentRecord`/`addSubjectToStudent`/
 * `removeSubjectFromStudent`/etc. run against their real, cache-backed logic instead of the
 * placeholder.
 */
function makeMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  } as unknown as Storage;
}

let createStudentRecord: typeof import("./data-store").createStudentRecord;
let getData: typeof import("./data-store").getData;
let resetData: typeof import("./data-store").resetData;
let recordPayment: typeof import("./data-store").recordPayment;
let addSubjectToStudent: typeof import("./data-store").addSubjectToStudent;
let removeSubjectFromStudent: typeof import("./data-store").removeSubjectFromStudent;
let updateStudentBasicInfo: typeof import("./data-store").updateStudentBasicInfo;

beforeAll(async () => {
  const g = globalThis as unknown as { window?: unknown; document?: unknown };
  g.window = {
    localStorage: makeMemoryStorage(),
    sessionStorage: makeMemoryStorage(),
    setInterval: () => 0,
    addEventListener: () => {},
  };
  const fakeHead = { appendChild: () => {} };
  g.document = {
    head: fakeHead,
    getElementsByTagName: () => [fakeHead],
    createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, textContent: "" }),
    createTextNode: () => ({}),
    addEventListener: () => {},
    visibilityState: "visible",
  };

  const mod = await import("./data-store");
  createStudentRecord = mod.createStudentRecord;
  getData = mod.getData;
  resetData = mod.resetData;
  recordPayment = mod.recordPayment;
  addSubjectToStudent = mod.addSubjectToStudent;
  removeSubjectFromStudent = mod.removeSubjectFromStudent;
  updateStudentBasicInfo = mod.updateStudentBasicInfo;
});

// الصف الأول الابتدائي (gd-1) يدرّس عربي/إنجليزي/رياضيات (sub-1/sub-2/sub-3) — راجع mock-data.ts.
const GRADE_ID = "gd-1";
const SUBJECT_ARABIC = "sub-1";
const SUBJECT_MATH = "sub-3";

function makeStudent(code: string) {
  const student = createStudentRecord({
    code,
    fullName: "طالب تجريبي",
    gradeId: GRADE_ID,
    guardianName: "ولي أمر تجريبي",
    guardianPhone: "0100000000",
    subjectIds: [SUBJECT_ARABIC],
    subjectFees: { [SUBJECT_ARABIC]: 100 },
  });
  if (!student) throw new Error("fixture creation failed — check GRADE_ID");
  return student;
}

beforeEach(() => {
  resetData();
});

describe("updateStudentBasicInfo", () => {
  test("يعدّل الاسم وبيانات ولي الأمر بدون تغيير code أو id", () => {
    const student = makeStudent("TEST-001");
    const result = updateStudentBasicInfo(student.id, {
      fullName: "اسم جديد",
      guardianPhone: "0111111111",
    });
    expect(result.ok).toBe(true);
    const updated = getData().students.find((s) => s.id === student.id)!;
    expect(updated.full_name).toBe("اسم جديد");
    expect(updated.guardian_phone).toBe("0111111111");
    expect(updated.id).toBe(student.id);
    expect(updated.code).toBe("TEST-001");
  });

  test("لا يُنشئ طالباً جديداً — عدد الطلاب يفضل كما هو بعد التعديل", () => {
    const student = makeStudent("TEST-002");
    const before = getData().students.length;
    updateStudentBasicInfo(student.id, { fullName: "تعديل" });
    expect(getData().students.length).toBe(before);
  });
});

describe("addSubjectToStudent — لا يمحي أثر مدفوعات سابقة", () => {
  test("يزيد المستحق بقيمة المادة الجديدة فقط، لا يعيد حسابه من الصفر", () => {
    const student = makeStudent("TEST-010");
    expect(student.balance_due).toBe(100); // مادة واحدة بـ 100

    // الطالب دفع 60 من أصل الـ100 المستحقة على المادة الأولى.
    recordPayment(student.code, 60, "cash", "دفعة جزئية");
    const afterPayment = getData().students.find((s) => s.id === student.id)!;
    expect(afterPayment.balance_due).toBe(40);

    // إضافة مادة جديدة بسعر 150 — المستحق المفروض يصبح 40+150=190، لا 150 (sumSubjectFees
    // كانت هتمحي أثر الدفعة السابقة لو استُخدمت هنا بدل الزيادة التراكمية).
    const result = addSubjectToStudent(student.id, SUBJECT_MATH, 150);
    expect(result.ok).toBe(true);
    const afterAdd = getData().students.find((s) => s.id === student.id)!;
    expect(afterAdd.balance_due).toBe(190);
    expect(afterAdd.subject_ids).toContain(SUBJECT_MATH);
    expect(afterAdd.subject_fees?.[SUBJECT_MATH]).toBe(150);
  });

  test("يرفض إضافة مادة مسجَّلة بالفعل", () => {
    const student = makeStudent("TEST-011");
    const result = addSubjectToStudent(student.id, SUBJECT_ARABIC, 100);
    expect(result.ok).toBe(false);
  });
});

describe("removeSubjectFromStudent — إلغاء مستقبلي فقط، لا حذف تاريخ", () => {
  test("يقلل المستحق بقيمة المادة المحذوفة فقط، بدون النزول تحت صفر", () => {
    const student = makeStudent("TEST-020");
    addSubjectToStudent(student.id, SUBJECT_MATH, 150);
    // المستحق الآن 100+150=250. ندفع 230.
    recordPayment(student.code, 230, "cash", "دفعة");
    expect(getData().students.find((s) => s.id === student.id)!.balance_due).toBe(20);

    const result = removeSubjectFromStudent(student.id, SUBJECT_MATH);
    expect(result.ok).toBe(true);
    const after = getData().students.find((s) => s.id === student.id)!;
    // 20 - 150 كانت هتبقى سالبة لولا Math.max(0, ...).
    expect(after.balance_due).toBe(0);
    expect(after.subject_ids).not.toContain(SUBJECT_MATH);
    expect(after.subject_fees?.[SUBJECT_MATH]).toBeUndefined();
  });

  test("لا يلمس المدفوعات السابقة المسجَّلة", () => {
    const student = makeStudent("TEST-021");
    addSubjectToStudent(student.id, SUBJECT_MATH, 150);
    recordPayment(student.code, 50, "cash", "دفعة قبل الحذف");
    const paymentsBefore = getData().payments.filter((p) => p.student_code === student.code).length;

    removeSubjectFromStudent(student.id, SUBJECT_MATH);

    const paymentsAfter = getData().payments.filter((p) => p.student_code === student.code).length;
    expect(paymentsAfter).toBe(paymentsBefore);
  });

  test("يرفض إزالة مادة غير مسجَّلة", () => {
    const student = makeStudent("TEST-022");
    const result = removeSubjectFromStudent(student.id, "sub-5");
    expect(result.ok).toBe(false);
  });
});
