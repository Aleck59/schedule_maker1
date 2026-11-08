-- Метки аудиторий: что предпочтительно в ней проводить (мягкое ограничение)
ALTER TABLE "classrooms" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
