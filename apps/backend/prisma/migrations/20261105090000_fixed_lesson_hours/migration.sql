-- Пара всегда 2 академических часа; длительность пары = длительность часа × 2
UPDATE "organization_settings"
SET "academicHoursPerLesson" = 2,
    "lessonDurationMinutes" = "academicHourMinutes" * 2;
