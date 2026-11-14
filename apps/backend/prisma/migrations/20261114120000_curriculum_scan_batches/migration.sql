-- Пакетная загрузка учебных планов: каждый файл — отдельная загрузка с общим batchId
ALTER TABLE "curriculum_scans" ADD COLUMN "batchId" TEXT;
ALTER TABLE "curriculum_scans" ADD COLUMN "autoApply" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "curriculum_scans_batchId_idx" ON "curriculum_scans"("batchId");
