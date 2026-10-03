// xlsx is CommonJS-only and breaks the edge/server bundle when imported at module scope.
// It is loaded lazily inside the browser-only download path instead.
type XLSXModule = typeof import("xlsx");

let xlsxPromise: Promise<XLSXModule> | undefined;

async function loadXlsx(): Promise<XLSXModule> {
  if (!xlsxPromise) {
    xlsxPromise = import("xlsx").then((m) => (m as unknown as { default?: XLSXModule }).default ?? m);
  }
  return xlsxPromise;
}

import type {
  AttendanceRecord,
  Group,
  HomeworkTask,
  PaymentRecord,
  QuizResult,
  Student,
  Teacher,
} from "@/types";

/**
 * SUPABASE_MIGRATION_SPEC.md §10-أ/ب — one sheet per entity, "كل شيت لكيان". Shared by both
 * the owner's self-service export button and the platform admin's per-center export tool
 * (§10-ب) — same workbook shape either way, just a different source of the rows.
 */
export interface CenterExportData {
  centerName: string;
  students: Student[];
  teachers: Teacher[];
  groups: Group[];
  attendanceRecords: AttendanceRecord[];
  payments: PaymentRecord[];
  quizResults: QuizResult[];
  homeworkTasks: HomeworkTask[];
}

let XLSX: XLSXModule = undefined as unknown as XLSXModule;

function sheetFromRows<T extends Record<string, unknown>>(rows: T[]) {
  return XLSX.utils.json_to_sheet(rows);
}

export async function buildCenterWorkbook(data: CenterExportData) {
  XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(
      data.students.map((s) => ({
        الكود: s.code,
        الاسم: s.full_name,
        الصف: s.grade,
        المجموعة: s.group_name,
        "اسم ولي الأمر": s.guardian_name,
        "هاتف ولي الأمر": s.guardian_phone,
        "حالة السداد": s.payment_status,
        "المتبقي عليه": s.balance_due,
        النقاط: s.points,
        "نسبة الحضور (%)": s.attendance_rate,
        // avg_score مُخزَّن داخلياً كنسبة ٠-١٠٠ — المدرس يدخّل كل درجة من ١٠ فعلياً،
        // فالقسمة على ١٠ ترجعها لنفس المقياس بدل عرض ٨٠ مكان ٨ في ملف إكسل.
        "متوسط الدرجات (من 10)": s.avg_score / 10,
      })),
    ),
    "الطلاب",
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(
      data.teachers.map((t) => ({
        الاسم: t.full_name,
        المادة: t.subject,
        "عدد المجموعات": t.groups,
        "عدد الطلاب": t.students,
        "الالتزام بالتوقيت": t.timer_compliance,
        "الإيراد الشهري": t.monthly_revenue,
      })),
    ),
    "المدرسين",
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(
      data.groups.map((g) => ({
        الاسم: g.name,
        المادة: g.subject,
        المدرس: g.teacher_name,
        الصف: g.grade,
        اليوم: g.weekday,
        الوقت: g.time,
        القاعة: g.room,
        المسجلون: g.enrolled,
        السعة: g.capacity,
      })),
    ),
    "المجموعات",
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(
      data.attendanceRecords.map((a) => ({
        الطالب: a.student_name,
        المجموعة: a.group_name,
        الحالة: a.status,
        الوقت: a.checked_in_at,
        الطريقة: a.method,
      })),
    ),
    "الحضور",
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(
      data.payments.map((p) => ({
        الطالب: p.student_name,
        الكود: p.student_code,
        المبلغ: p.amount,
        الطريقة: p.method,
        البند: p.item,
        التاريخ: p.created_at,
      })),
    ),
    "المدفوعات",
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(
      data.quizResults.map((q) => ({
        الطالب: q.student_id,
        المادة: q.subject,
        العنوان: q.title,
        التاريخ: q.date,
        الدرجة: q.score,
        "من إجمالي": q.max_score,
      })),
    ),
    "الدرجات",
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(
      data.homeworkTasks.map((h) => ({
        الطالب: h.student_id,
        المادة: h.subject,
        العنوان: h.title,
        "موعد التسليم": h.due_date,
        الحالة: h.status,
        الدرجة: h.grade ?? "",
      })),
    ),
    "الواجبات",
  );

  return wb;
}

export async function downloadCenterExcel(data: CenterExportData) {
  const wb = await buildCenterWorkbook(data);
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${data.centerName}-${stamp}.xlsx`, { bookType: "xlsx" });
}
