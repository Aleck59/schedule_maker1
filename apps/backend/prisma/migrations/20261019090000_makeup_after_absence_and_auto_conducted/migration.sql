-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN     "makeupAfterReturn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "makeupExtraWeekly" INTEGER NOT NULL DEFAULT 4;

-- AlterTable
ALTER TABLE "organization_settings" ADD COLUMN     "autoMarkConducted" BOOLEAN NOT NULL DEFAULT true;

