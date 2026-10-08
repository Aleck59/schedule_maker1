-- CreateEnum
CREATE TYPE "AvailabilityRuleKind" AS ENUM ('UNAVAILABLE', 'AVAILABLE_ONLY', 'PREFERRED', 'UNDESIRED', 'ONLINE');

-- CreateEnum
CREATE TYPE "WeekParity" AS ENUM ('ANY', 'ODD', 'EVEN');

-- CreateTable
CREATE TABLE "teacher_availability_rules" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "kind" "AvailabilityRuleKind" NOT NULL,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "lessonNumbers" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "timeFrom" TEXT,
    "timeTo" TEXT,
    "parity" "WeekParity" NOT NULL DEFAULT 'ANY',
    "monthWeeks" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "validFrom" DATE,
    "validTo" DATE,
    "weight" INTEGER NOT NULL DEFAULT 5,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teacher_availability_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "teacher_availability_rules_teacherId_idx" ON "teacher_availability_rules"("teacherId");

-- AddForeignKey
ALTER TABLE "teacher_availability_rules" ADD CONSTRAINT "teacher_availability_rules_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
