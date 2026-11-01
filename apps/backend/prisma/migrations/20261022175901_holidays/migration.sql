-- CreateEnum
CREATE TYPE "HolidayKind" AS ENUM ('FEDERAL', 'REGIONAL', 'CUSTOM');

-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN     "holidayYear" INTEGER;

-- AlterTable
ALTER TABLE "organization_settings" ADD COLUMN     "holidayAutoTransfer" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "holidaysInitialized" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "HolidayKind" NOT NULL DEFAULT 'CUSTOM',
    "month" INTEGER,
    "day" INTEGER,
    "date" DATE,
    "transferable" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday_transfers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "basis" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holiday_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "holidays_organizationId_idx" ON "holidays"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_transfers_organizationId_fromDate_key" ON "holiday_transfers"("organizationId", "fromDate");

-- CreateIndex
CREATE INDEX "calendar_events_organizationId_holidayYear_idx" ON "calendar_events"("organizationId", "holidayYear");

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday_transfers" ADD CONSTRAINT "holiday_transfers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
