-- С какой пары сложные дисциплины считаются поздними (раньше было зашито: с 4-й)
ALTER TABLE "organization_settings" ADD COLUMN "difficultLessonNumber" INTEGER NOT NULL DEFAULT 4;
