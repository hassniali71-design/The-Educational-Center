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
