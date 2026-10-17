-- CreateEnum
CREATE TYPE "EducationLevel" AS ENUM ('SPO', 'BACHELOR', 'SPECIALIST', 'MASTER', 'POSTGRADUATE');

-- AlterTable
ALTER TABLE "schedule_generation_jobs" ADD COLUMN     "periodIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "specialties" ADD COLUMN     "educationLevel" "EducationLevel" NOT NULL DEFAULT 'SPO';

-- AlterTable
ALTER TABLE "student_groups" ADD COLUMN     "firstLessonNumber" INTEGER,
ADD COLUMN     "lastLessonNumber" INTEGER,
ADD COLUMN     "studyDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- Уровень образования существующих специальностей — по коду (00.03.00 — бакалавриат и т.д.)
UPDATE "specialties" SET "educationLevel" = (CASE split_part("code", '.', 2)
  WHEN '03' THEN 'BACHELOR'
  WHEN '04' THEN 'MASTER'
  WHEN '05' THEN 'SPECIALIST'
  WHEN '06' THEN 'POSTGRADUATE'
  WHEN '07' THEN 'POSTGRADUATE'
  WHEN '08' THEN 'POSTGRADUATE'
  ELSE 'SPO'
END)::"EducationLevel";
