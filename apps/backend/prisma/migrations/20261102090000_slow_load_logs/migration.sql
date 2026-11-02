-- CreateTable
CREATE TABLE "slow_load_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "page" TEXT NOT NULL,
    "requests" TEXT[],
    "durationMs" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slow_load_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "slow_load_logs_organizationId_createdAt_idx" ON "slow_load_logs"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "slow_load_logs" ADD CONSTRAINT "slow_load_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slow_load_logs" ADD CONSTRAINT "slow_load_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

