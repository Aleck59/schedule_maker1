-- Начало учебного года и типовые границы семестров (раньше были зашиты в коде)
ALTER TABLE "organization_settings" ADD COLUMN "academicYearStart" TEXT NOT NULL DEFAULT '09-01',
ADD COLUMN "firstSemesterEnd" TEXT NOT NULL DEFAULT '12-31',
ADD COLUMN "secondSemesterStart" TEXT NOT NULL DEFAULT '01-12',
ADD COLUMN "secondSemesterEnd" TEXT NOT NULL DEFAULT '06-30';
