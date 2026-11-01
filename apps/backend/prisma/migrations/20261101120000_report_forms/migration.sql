-- CreateTable
CREATE TABLE "report_forms" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dataSource" TEXT,
    "content" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_forms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_forms_organizationId_idx" ON "report_forms"("organizationId");

-- AddForeignKey
ALTER TABLE "report_forms" ADD CONSTRAINT "report_forms_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
