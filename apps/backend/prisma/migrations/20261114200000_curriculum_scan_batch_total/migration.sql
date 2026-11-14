-- Последовательная пакетная загрузка: сколько файлов ожидается в пакете (уведомление — после последнего)
ALTER TABLE "curriculum_scans" ADD COLUMN "batchTotal" INTEGER;
