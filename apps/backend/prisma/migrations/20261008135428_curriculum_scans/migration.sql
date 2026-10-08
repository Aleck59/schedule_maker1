-- CreateEnum
CREATE TYPE "CurriculumScanStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED', 'APPLIED');

-- CreateTable
CREATE TABLE "curriculum_scans" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT,
    "fileNames" TEXT[],
    "status" "CurriculumScanStatus" NOT NULL DEFAULT 'PROCESSING',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "message" TEXT,
    "error" TEXT,
    "resultJson" JSONB,
    "programId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "curriculum_scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "curriculum_scans_organizationId_createdAt_idx" ON "curriculum_scans"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "curriculum_scans" ADD CONSTRAINT "curriculum_scans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
