-- Периоды «С», загруженные раньше из .plx как «Прочее», переводятся в «Самостоятельную работу»
UPDATE "calendar_events"
SET "eventType" = 'SELF_STUDY'
WHERE "eventType" = 'OTHER' AND "title" ILIKE 'Самостоятельная работа%';
