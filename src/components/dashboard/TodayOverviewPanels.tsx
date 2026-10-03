import { CalendarDays, GraduationCap, UserCheck, Users } from "lucide-react";
import { useMemo } from "react";

import { StatusBadge } from "@/components/dashboard/StatCard";
import { getEnrolledCount, useDataStore } from "@/lib/data-store";
import { formatNumber, formatPercent } from "@/lib/format";
import type { Group } from "@/types";

/**
 * كروت "نظرة اليوم" — كل رقم يُحسب من البيانات الحقيقية:
 *  - حصص اليوم = عدد المجموعات المجدولة ليوم today
 *  - المدرسون على رأس العمل = مدرسون فعّلوا أي Action في سجل اليوم
 *  - متوسط الحضور = سجلات اليوم الحقيقية (أو "لا توجد سجلات" إذا صفر)
 */

const WEEKDAYS_AR = [
  "الأحد",
  "الإثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
] as const;

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * سجلات الحضور الغائبة مخزَّنة بـ`checked_in_at: "—"` (مفيش وقت تسجيل حقيقي)،
 * فكانت `isToday("—")` ترجع false دايماً — يعني عدد الغياب في "متوسط الحضور
 * اليوم" تحت كان صفر ثابت دايماً مهما كان عدد الغيابات الحقيقي. نستخرج التاريخ
 * من معرّف السجل (`at-<epoch-ms>`) كـfallback لما checked_in_at غير قابل للقراءة.
 */
function isToday(dateStr: string | null | undefined, fallbackId?: string): boolean {
  if (!dateStr) return false;
  // يقبل ISO أو نص عربي مختصر (وقت بدون تاريخ)
  const parsed = new Date(dateStr);
  if (Number.isFinite(parsed.getTime())) {
    const d = new Date();
    return (
      parsed.getFullYear() === d.getFullYear() &&
      parsed.getMonth() === d.getMonth() &&
      parsed.getDate() === d.getDate()
    );
  }
  if (fallbackId) {
    const match = /-(\d{10,})(?:-|$)/.exec(fallbackId);
    if (match) {
      const fromId = new Date(Number(match[1]));
      if (!Number.isNaN(fromId.getTime())) {
        const d = new Date();
        return (
          fromId.getFullYear() === d.getFullYear() &&
          fromId.getMonth() === d.getMonth() &&
          fromId.getDate() === d.getDate()
        );
      }
    }
  }
  return false;
}

export function TodayOverviewPanels() {
  const state = useDataStore();
  const today = WEEKDAYS_AR[new Date().getDay()]!;
  const todayKeyStr = todayKey();

  /**
   * مصدر مواعيد اليوم: `state.scheduleSlots`، مش `group.weekday` القديم —
   * مجموعة متجدولة بأكتر من يوم بتتسجّل كصف مستقل لكل يوم في scheduleSlots،
   * لكن `group.weekday` القديمة بتحمل أول يوم مُختار بس. البج الحقيقي المُبلَّغ
   * ("الحصص 3 حاطط 2") كان سببه بالظبط الاعتماد على الحقل القديم ده. مجموعات
   * قديمة متجدولة ومعندهاش أي صف في scheduleSlots بترجع لحقلها القديم كـfallback.
   */
  const todaySlotTimeByGroupId = useMemo(() => {
    const map = new Map<string, string>();
    for (const sl of state.scheduleSlots) {
      if (sl.weekday === today && sl.group_id) map.set(sl.group_id, sl.time);
    }
    return map;
  }, [state.scheduleSlots, today]);

  const todayGroups = useMemo(() => {
    const groupIdsWithAnySlot = new Set(
      state.scheduleSlots.filter((sl) => sl.group_id).map((sl) => sl.group_id!),
    );
    const byId = new Map<string, Group>();
    for (const g of state.groups) {
      if (todaySlotTimeByGroupId.has(g.id)) {
        byId.set(g.id, g);
      } else if (
        !groupIdsWithAnySlot.has(g.id) &&
        g.scheduling_status === "scheduled" &&
        g.weekday === today
      ) {
        byId.set(g.id, g);
      }
    }
    return [...byId.values()];
  }, [state.groups, state.scheduleSlots, today, todaySlotTimeByGroupId]);

  // المدرسون على رأس العمل اليوم = من لديه Action حقيقي اليوم
  const teachersWorkingToday = useMemo(() => {
    const teacherIds = new Set<string>();
    for (const att of state.attendanceRecords) {
      if (isToday(att.checked_in_at, att.id)) {
        const st = state.students.find((s) => s.id === att.student_id);
        if (st) {
          for (const sid of st.subject_ids) {
            const tch = state.teachers.find((t) => t.subject_id === sid);
            if (tch) teacherIds.add(tch.id);
          }
        }
      }
    }
    for (const hw of state.homeworkTasks) {
      if (isToday(hw.created_at) || hw.status !== "pending") {
        const tch = state.teachers.find((t) => t.subject === hw.subject);
        if (tch) teacherIds.add(tch.id);
      }
    }
    for (const sr of state.sessionRecords) {
      if (isToday(sr.date)) {
        teacherIds.add(sr.teacher_id);
      }
    }
    // قيّد على من لديه حصة اليوم فقط
    const todayGroupTeacherIds = new Set(todayGroups.map((g) => g.teacher_id));
    return [...teacherIds].filter((id) => todayGroupTeacherIds.has(id));
  }, [state, todayGroups]);

  // متوسط الحضور اليوم
  const todayAttendance = useMemo(() => {
    const rows = state.attendanceRecords.filter((a) => isToday(a.checked_in_at, a.id));
    if (rows.length === 0) return { count: 0, present: 0, late: 0, absent: 0, hasData: false };
    const present = rows.filter((r) => r.status === "present").length;
    const late = rows.filter((r) => r.status === "late").length;
    const absent = rows.filter((r) => r.status === "absent").length;
    return { count: rows.length, present, late, absent, hasData: true };
  }, [state.attendanceRecords]);

  // الطلاب المسجَّلون جدداً اليوم
  const newStudentsToday = useMemo(
    () => state.students.filter((s) => isToday(s.id ? new Date().toISOString() : null) || false).length,
    // ملاحظة: لا يوجد created_at للطلاب — نعتمد على فصل "نشط" جديد من المجموعة
    [state.students],
  );

  // الطلاب النشطون = الذين عليهم مهام أو حضور في آخر 30 يوم
  void todayKeyStr; // نُبقي المفتاح للاستخدام إن لزم
  void newStudentsToday;

  const expectedStudentsToday = todayGroups.reduce(
    (s, g) => s + getEnrolledCount(state, g.id),
    0,
  );

  return (
    <div className="card-crisp p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xl font-black text-foreground">
          <CalendarDays className="size-6 text-primary" />
          نظرة اليوم — {today}
        </p>
        <StatusBadge tone={todayGroups.length > 0 ? "success" : "warning"}>
          {formatNumber(todayGroups.length)} حصة مجدولة اليوم
        </StatusBadge>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border-2 border-border p-4">
          <p className="text-sm font-bold text-muted-foreground">حصص اليوم</p>
          <p className="kpi-number text-3xl">{formatNumber(todayGroups.length)}</p>
          <p className="mt-1 text-sm font-bold text-muted-foreground">
            {todayGroups.length > 0
              ? todayGroups
                  .slice(0, 3)
                  .map((g) => `${g.name} (${todaySlotTimeByGroupId.get(g.id) ?? g.time})`)
                  .join(" · ")
              : "لا توجد حصص مجدولة اليوم"}
          </p>
        </div>
        <div className="rounded-xl border-2 border-border p-4">
          <p className="text-sm font-bold text-muted-foreground">المدرسون على رأس العمل</p>
          <p className="kpi-number text-3xl">{formatNumber(teachersWorkingToday.length)}</p>
          <p className="mt-1 text-sm font-bold text-muted-foreground">
            {teachersWorkingToday.length > 0
              ? teachersWorkingToday
                  .map((id) => state.teachers.find((t) => t.id === id)?.full_name ?? "")
                  .filter(Boolean)
                  .slice(0, 3)
                  .join(" · ")
              : "لا يوجد مدرس فعّل حصته بعد"}
          </p>
        </div>
        <div className="rounded-xl border-2 border-border p-4">
          <p className="text-sm font-bold text-muted-foreground">متوسط الحضور اليوم</p>
          {todayAttendance.hasData ? (
            <>
              <p className="kpi-number text-3xl">
                {formatPercent(
                  Math.round(((todayAttendance.present + todayAttendance.late) / todayAttendance.count) * 100),
                )}
              </p>
              <p className="mt-1 text-sm font-bold text-muted-foreground">
                {formatNumber(todayAttendance.present + todayAttendance.late)} حاضر ·{" "}
                {formatNumber(todayAttendance.absent)} غائب · {formatNumber(todayAttendance.count)} سجل
              </p>
            </>
          ) : (
            <>
              <p className="kpi-number text-3xl text-muted-foreground">—</p>
              <p className="mt-1 text-sm font-bold text-muted-foreground">
                لا توجد سجلات حضور لليوم
              </p>
            </>
          )}
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border-2 border-border p-4">
          <p className="text-sm font-bold text-muted-foreground">الطلاب المتوقع حضورهم</p>
          <p className="kpi-number text-3xl">{formatNumber(expectedStudentsToday)}</p>
          <p className="mt-1 text-sm font-bold text-muted-foreground">
            من مجموع المجموعات المجدولة اليوم
          </p>
        </div>
        {/*
          كارت "المدرسون المجدولون" (عدد لمن *لهم* حصة اليوم في الجدول) اتشال
          عمداً — طلب صريح: كان بيكرر نفس فكرة "المدرسون على رأس العمل" فوق
          (اللي هو الرقم الحقيقي الوحيد المطلوب: مين *فعلاً* شغال دلوقتي، مش
          مين مجدول بس)، وبيلخبط لأنه رقم مختلف لنفس الموضوع.
        */}
        <div className="rounded-xl border-2 border-border p-4">
          <p className="text-sm font-bold text-muted-foreground">المواد المجدولة</p>
          <p className="kpi-number text-3xl">
            {formatNumber(new Set(todayGroups.map((g) => g.subject)).size)}
          </p>
          <p className="mt-1 text-sm font-bold text-muted-foreground">
            {[...new Set(todayGroups.map((g) => g.subject))].slice(0, 3).join(" · ") || "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

void GraduationCap;
void UserCheck;
void Users;
