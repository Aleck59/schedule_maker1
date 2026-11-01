-- CreateTable
CREATE TABLE "permanent_schedules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "semesterIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "educationLevels" "EducationLevel"[] DEFAULT ARRAY[]::"EducationLevel"[],
    "programIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "notes" TEXT,
    "jobStatus" "GenerationJobStatus",
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "resultJson" JSONB,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permanent_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permanent_lessons" (
    "id" TEXT NOT NULL,
    "permanentScheduleId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "lessonNumber" INTEGER NOT NULL,
    "weekParity" "WeekParity" NOT NULL DEFAULT 'ANY',
    "studentGroupId" TEXT NOT NULL,
    "subgroupNumber" INTEGER,
    "semesterCurriculumItemId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "teacherId" TEXT,
    "classroomId" TEXT,
    "lessonType" "LessonType" NOT NULL,
    "streamKey" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permanent_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "permanent_schedules_organizationId_idx" ON "permanent_schedules"("organizationId");

-- CreateIndex
CREATE INDEX "permanent_lessons_permanentScheduleId_weekday_lessonNumber_idx" ON "permanent_lessons"("permanentScheduleId", "weekday", "lessonNumber");

-- CreateIndex
CREATE INDEX "permanent_lessons_studentGroupId_idx" ON "permanent_lessons"("studentGroupId");

-- CreateIndex
CREATE INDEX "permanent_lessons_teacherId_idx" ON "permanent_lessons"("teacherId");

-- CreateIndex
CREATE INDEX "permanent_lessons_classroomId_idx" ON "permanent_lessons"("classroomId");

-- AddForeignKey
ALTER TABLE "permanent_schedules" ADD CONSTRAINT "permanent_schedules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permanent_lessons" ADD CONSTRAINT "permanent_lessons_permanentScheduleId_fkey" FOREIGN KEY ("permanentScheduleId") REFERENCES "permanent_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permanent_lessons" ADD CONSTRAINT "permanent_lessons_studentGroupId_fkey" FOREIGN KEY ("studentGroupId") REFERENCES "student_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permanent_lessons" ADD CONSTRAINT "permanent_lessons_semesterCurriculumItemId_fkey" FOREIGN KEY ("semesterCurriculumItemId") REFERENCES "semester_curriculum_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permanent_lessons" ADD CONSTRAINT "permanent_lessons_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "group_curriculum_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permanent_lessons" ADD CONSTRAINT "permanent_lessons_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permanent_lessons" ADD CONSTRAINT "permanent_lessons_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "classrooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
