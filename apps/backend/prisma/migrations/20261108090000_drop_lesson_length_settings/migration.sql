-- Пара всегда 2 академических часа, её время задаётся звонками: поля длительности не нужны
ALTER TABLE "organization_settings" DROP COLUMN "academicHoursPerLesson",
DROP COLUMN "academicHourMinutes",
DROP COLUMN "lessonDurationMinutes";
