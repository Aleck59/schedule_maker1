-- Лимит пар в неделю по формам обучения и снижение нагрузки очников во время занятий заочников
ALTER TABLE "organization_settings" ADD COLUMN "maxWeeklyLessonsFullTime" INTEGER;
ALTER TABLE "organization_settings" ADD COLUMN "maxWeeklyLessonsPartTime" INTEGER;
ALTER TABLE "organization_settings" ADD COLUMN "maxWeeklyLessonsExtramural" INTEGER;
ALTER TABLE "organization_settings" ADD COLUMN "reduceFullTimeOnExtramural" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organization_settings" ADD COLUMN "fullTimeWeeklyOnExtramural" INTEGER;
