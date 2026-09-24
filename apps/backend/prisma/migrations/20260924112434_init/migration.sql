-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'DISPATCHER', 'TEACHER', 'STUDENT', 'MANAGER');

-- CreateEnum
CREATE TYPE "ProgramStatus" AS ENUM ('DRAFT', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StudyForm" AS ENUM ('FULL_TIME', 'PART_TIME', 'EXTRAMURAL');

-- CreateEnum
CREATE TYPE "CurriculumItemType" AS ENUM ('DISCIPLINE', 'MODULE', 'INTERDISCIPLINARY_COURSE', 'EDUCATIONAL_PRACTICE', 'INDUSTRIAL_PRACTICE', 'PRE_DIPLOMA_PRACTICE', 'FINAL_ATTESTATION', 'ELECTIVE');

-- CreateEnum
CREATE TYPE "ControlForm" AS ENUM ('NONE', 'EXAM', 'CREDIT', 'DIFFERENTIATED_CREDIT', 'OTHER', 'COURSE_PROJECT', 'QUALIFICATION_EXAM');

-- CreateEnum
CREATE TYPE "ClassroomType" AS ENUM ('LECTURE', 'COMPUTER_LAB', 'LABORATORY', 'WORKSHOP', 'SPORTS_HALL', 'GENERAL', 'ONLINE');

-- CreateEnum
CREATE TYPE "CalendarEventType" AS ENUM ('THEORETICAL_TRAINING', 'EXAM_SESSION', 'VACATION', 'EDUCATIONAL_PRACTICE', 'INDUSTRIAL_PRACTICE', 'PRE_DIPLOMA_PRACTICE', 'FINAL_ATTESTATION', 'DIPLOMA_PREPARATION', 'DIPLOMA_DEFENSE', 'DEMO_EXAM_PREPARATION', 'DEMO_EXAM', 'REATTESTATION', 'HOLIDAY', 'OTHER');

-- CreateEnum
CREATE TYPE "SchedulePeriodStatus" AS ENUM ('DRAFT', 'GENERATED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LessonType" AS ENUM ('LECTURE', 'PRACTICAL', 'LABORATORY', 'CONSULTATION', 'PRACTICE', 'OTHER');

-- CreateEnum
CREATE TYPE "LessonStatus" AS ENUM ('PLANNED', 'CONDUCTED', 'CANCELLED', 'MOVED', 'REPLACED');

-- CreateEnum
CREATE TYPE "ConductedStatus" AS ENUM ('CONDUCTED', 'CANCELLED', 'POSTPONED', 'REPLACED');

-- CreateEnum
CREATE TYPE "CancellationReason" AS ENUM ('GROUP_ABSENT', 'TEACHER_ABSENT', 'CLASSROOM_UNAVAILABLE', 'HOLIDAY', 'OTHER');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('ERROR', 'WARNING', 'INFO');

-- CreateEnum
CREATE TYPE "GenerationMode" AS ENUM ('CALENDAR', 'WEEKLY_TEMPLATE');

-- CreateEnum
CREATE TYPE "GenerationJobStatus" AS ENUM ('QUEUED', 'GENERATING', 'VALIDATING', 'COMPLETED', 'COMPLETED_WITH_CONFLICTS', 'FAILED', 'APPLIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MakeupTaskStatus" AS ENUM ('OPEN', 'SCHEDULED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('LESSON_CANCELLED', 'LESSON_MOVED', 'TEACHER_SUBSTITUTED', 'LESSON_CREATED', 'LESSON_UPDATED', 'SCHEDULE_PUBLISHED', 'GENERAL');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "address" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "academicHoursPerLesson" INTEGER NOT NULL DEFAULT 2,
    "academicHourMinutes" INTEGER NOT NULL DEFAULT 45,
    "lessonDurationMinutes" INTEGER NOT NULL DEFAULT 90,
    "lessonsPerDay" INTEGER NOT NULL DEFAULT 6,
    "maxGroupLessonsPerDay" INTEGER NOT NULL DEFAULT 4,
    "maxSameDisciplinePerDay" INTEGER NOT NULL DEFAULT 2,
    "maxSameDisciplinePerWeek" INTEGER NOT NULL DEFAULT 2,
    "lateLessonNumber" INTEGER NOT NULL DEFAULT 5,
    "workingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "maxGroupWindowsPerWeek" INTEGER NOT NULL DEFAULT 2,
    "maxTeacherWindowsPerWeek" INTEGER NOT NULL DEFAULT 4,
    "maxExamsPerWeek" INTEGER NOT NULL DEFAULT 3,
    "maxBuildingChangesPerDay" INTEGER NOT NULL DEFAULT 1,
    "warnOnPartialLessons" BOOLEAN NOT NULL DEFAULT true,
    "scheduleConsultations" BOOLEAN NOT NULL DEFAULT true,
    "consultationWeeksBeforeEnd" INTEGER NOT NULL DEFAULT 3,
    "solverTimeLimitSeconds" INTEGER NOT NULL DEFAULT 60,
    "solverWeightsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_times" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lessonNumber" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_times_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "teacherId" TEXT,
    "studentGroupId" TEXT,
    "refreshTokenHash" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specialties" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qualification" TEXT NOT NULL,
    "fgosNumber" TEXT,
    "fgosDate" DATE,
    "durationMonths" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "educational_programs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "specialtyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "admissionYear" INTEGER NOT NULL,
    "studyForm" "StudyForm" NOT NULL DEFAULT 'FULL_TIME',
    "durationMonths" INTEGER NOT NULL,
    "totalSemesters" INTEGER NOT NULL,
    "status" "ProgramStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "educational_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_years" (
    "id" TEXT NOT NULL,
    "educationalProgramId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "courseNumber" INTEGER,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "semesters" (
    "id" TEXT NOT NULL,
    "educationalProgramId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "courseNumber" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "theoreticalWeeks" INTEGER NOT NULL DEFAULT 0,
    "examWeeks" INTEGER NOT NULL DEFAULT 0,
    "vacationWeeks" INTEGER NOT NULL DEFAULT 0,
    "practiceWeeks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "semesters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_groups" (
    "id" TEXT NOT NULL,
    "educationalProgramId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "admissionYear" INTEGER NOT NULL,
    "courseNumber" INTEGER NOT NULL,
    "currentSemesterNumber" INTEGER NOT NULL,
    "studentCount" INTEGER NOT NULL,
    "subgroupCount" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subgroups" (
    "id" TEXT NOT NULL,
    "studentGroupId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "studentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subgroups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" TEXT NOT NULL,
    "studentGroupId" TEXT NOT NULL,
    "subgroupId" TEXT,
    "fullName" TEXT NOT NULL,
    "recordBookNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curriculum_cycles" (
    "id" TEXT NOT NULL,
    "educationalProgramId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "curriculum_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curriculum_items" (
    "id" TEXT NOT NULL,
    "educationalProgramId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "parentItemId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "itemType" "CurriculumItemType" NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isDifficult" BOOLEAN NOT NULL DEFAULT false,
    "department" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "curriculum_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "semester_curriculum_items" (
    "id" TEXT NOT NULL,
    "curriculumItemId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "totalHours" INTEGER NOT NULL DEFAULT 0,
    "lectureHours" INTEGER NOT NULL DEFAULT 0,
    "practicalHours" INTEGER NOT NULL DEFAULT 0,
    "laboratoryHours" INTEGER NOT NULL DEFAULT 0,
    "consultationHours" INTEGER NOT NULL DEFAULT 0,
    "selfStudyHours" INTEGER NOT NULL DEFAULT 0,
    "assessmentHours" INTEGER NOT NULL DEFAULT 0,
    "practiceHours" INTEGER NOT NULL DEFAULT 0,
    "plannedLectureLessons" INTEGER NOT NULL DEFAULT 0,
    "plannedPracticalLessons" INTEGER NOT NULL DEFAULT 0,
    "plannedLaboratoryLessons" INTEGER NOT NULL DEFAULT 0,
    "plannedConsultationLessons" INTEGER NOT NULL DEFAULT 0,
    "plannedPracticeLessons" INTEGER NOT NULL DEFAULT 0,
    "controlForm" "ControlForm" NOT NULL DEFAULT 'NONE',
    "practiceAtCollege" BOOLEAN NOT NULL DEFAULT false,
    "scheduleConsultations" BOOLEAN NOT NULL DEFAULT true,
    "lectureRoomTypes" "ClassroomType"[] DEFAULT ARRAY[]::"ClassroomType"[],
    "practicalRoomTypes" "ClassroomType"[] DEFAULT ARRAY[]::"ClassroomType"[],
    "laboratoryRoomTypes" "ClassroomType"[] DEFAULT ARRAY[]::"ClassroomType"[],
    "consultationRoomTypes" "ClassroomType"[] DEFAULT ARRAY[]::"ClassroomType"[],
    "practiceRoomTypes" "ClassroomType"[] DEFAULT ARRAY[]::"ClassroomType"[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "semester_curriculum_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_curriculum_assignments" (
    "id" TEXT NOT NULL,
    "studentGroupId" TEXT NOT NULL,
    "semesterCurriculumItemId" TEXT NOT NULL,
    "subgroupNumber" INTEGER,
    "lessonType" "LessonType",
    "teacherId" TEXT,
    "weeklyLessonTarget" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "plannedHours" INTEGER,
    "preferredClassroomId" TEXT,
    "classroomTypes" "ClassroomType"[] DEFAULT ARRAY[]::"ClassroomType"[],
    "streamKey" TEXT,
    "allowHoursExcess" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_curriculum_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teachers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "department" TEXT,
    "position" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "maxWeeklyLessons" INTEGER NOT NULL DEFAULT 18,
    "maxDailyLessons" INTEGER NOT NULL DEFAULT 4,
    "preferredStartLesson" INTEGER NOT NULL DEFAULT 1,
    "preferredEndLesson" INTEGER NOT NULL DEFAULT 6,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_availability" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "lessonNumber" INTEGER NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "preferenceWeight" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teacher_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classrooms" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "building" TEXT,
    "floor" INTEGER,
    "capacity" INTEGER NOT NULL,
    "classroomType" "ClassroomType" NOT NULL,
    "equipmentJson" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classrooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classroom_availability" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "lessonNumber" INTEGER NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classroom_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "educationalProgramId" TEXT,
    "semesterId" TEXT,
    "studentGroupId" TEXT,
    "courseNumber" INTEGER,
    "teacherId" TEXT,
    "eventType" "CalendarEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "blocksSchedule" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_events" (
    "id" TEXT NOT NULL,
    "studentGroupId" TEXT NOT NULL,
    "semesterCurriculumItemId" TEXT NOT NULL,
    "controlForm" "ControlForm" NOT NULL,
    "date" DATE NOT NULL,
    "lessonNumber" INTEGER,
    "teacherId" TEXT,
    "classroomId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_periods" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "SchedulePeriodStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_lessons" (
    "id" TEXT NOT NULL,
    "schedulePeriodId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "weekday" INTEGER NOT NULL,
    "lessonNumber" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "studentGroupId" TEXT NOT NULL,
    "subgroupNumber" INTEGER,
    "semesterCurriculumItemId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "teacherId" TEXT,
    "classroomId" TEXT,
    "lessonType" "LessonType" NOT NULL,
    "status" "LessonStatus" NOT NULL DEFAULT 'PLANNED',
    "academicHours" INTEGER NOT NULL DEFAULT 2,
    "originalLessonId" TEXT,
    "streamKey" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "allowHoursExcess" BOOLEAN NOT NULL DEFAULT false,
    "generationJobId" TEXT,
    "topic" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conducted_lessons" (
    "id" TEXT NOT NULL,
    "scheduleLessonId" TEXT NOT NULL,
    "actualTeacherId" TEXT,
    "actualClassroomId" TEXT,
    "conductedAt" TIMESTAMP(3) NOT NULL,
    "actualHours" INTEGER NOT NULL DEFAULT 0,
    "status" "ConductedStatus" NOT NULL,
    "cancellationReason" "CancellationReason",
    "replacementLessonId" TEXT,
    "markedByUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conducted_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_substitutions" (
    "id" TEXT NOT NULL,
    "scheduleLessonId" TEXT NOT NULL,
    "originalTeacherId" TEXT,
    "substituteTeacherId" TEXT NOT NULL,
    "reason" TEXT,
    "approvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teacher_substitutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "makeup_tasks" (
    "id" TEXT NOT NULL,
    "sourceLessonId" TEXT NOT NULL,
    "studentGroupId" TEXT NOT NULL,
    "subgroupNumber" INTEGER,
    "semesterCurriculumItemId" TEXT NOT NULL,
    "teacherId" TEXT,
    "lessonType" "LessonType" NOT NULL,
    "academicHours" INTEGER NOT NULL,
    "status" "MakeupTaskStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedLessonId" TEXT,
    "dueDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "makeup_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_generation_jobs" (
    "id" TEXT NOT NULL,
    "schedulePeriodId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "status" "GenerationJobStatus" NOT NULL DEFAULT 'QUEUED',
    "mode" "GenerationMode" NOT NULL,
    "paramsJson" JSONB NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "solver" TEXT,
    "resultJson" JSONB,
    "statsJson" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation_results" (
    "id" TEXT NOT NULL,
    "schedulePeriodId" TEXT,
    "educationalProgramId" TEXT,
    "severity" "Severity" NOT NULL,
    "validationType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "message" TEXT NOT NULL,
    "detailsJson" JSONB,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "validation_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "scheduleLessonId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "oldDataJson" JSONB,
    "newDataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_settings_organizationId_key" ON "organization_settings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_times_organizationId_lessonNumber_key" ON "lesson_times"("organizationId", "lessonNumber");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_teacherId_key" ON "users"("teacherId");

-- CreateIndex
CREATE INDEX "users_organizationId_idx" ON "users"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "specialties_code_qualification_key" ON "specialties"("code", "qualification");

-- CreateIndex
CREATE INDEX "educational_programs_organizationId_idx" ON "educational_programs"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_educationalProgramId_title_key" ON "academic_years"("educationalProgramId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "semesters_educationalProgramId_number_key" ON "semesters"("educationalProgramId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "student_groups_code_key" ON "student_groups"("code");

-- CreateIndex
CREATE INDEX "student_groups_educationalProgramId_idx" ON "student_groups"("educationalProgramId");

-- CreateIndex
CREATE UNIQUE INDEX "subgroups_studentGroupId_number_key" ON "subgroups"("studentGroupId", "number");

-- CreateIndex
CREATE INDEX "students_studentGroupId_idx" ON "students"("studentGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_cycles_educationalProgramId_code_key" ON "curriculum_cycles"("educationalProgramId", "code");

-- CreateIndex
CREATE INDEX "curriculum_items_cycleId_idx" ON "curriculum_items"("cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_items_educationalProgramId_code_key" ON "curriculum_items"("educationalProgramId", "code");

-- CreateIndex
CREATE INDEX "semester_curriculum_items_semesterId_idx" ON "semester_curriculum_items"("semesterId");

-- CreateIndex
CREATE UNIQUE INDEX "semester_curriculum_items_curriculumItemId_semesterId_key" ON "semester_curriculum_items"("curriculumItemId", "semesterId");

-- CreateIndex
CREATE INDEX "group_curriculum_assignments_studentGroupId_semesterCurricu_idx" ON "group_curriculum_assignments"("studentGroupId", "semesterCurriculumItemId");

-- CreateIndex
CREATE INDEX "group_curriculum_assignments_teacherId_idx" ON "group_curriculum_assignments"("teacherId");

-- CreateIndex
CREATE INDEX "teachers_organizationId_idx" ON "teachers"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_availability_teacherId_weekday_lessonNumber_key" ON "teacher_availability"("teacherId", "weekday", "lessonNumber");

-- CreateIndex
CREATE UNIQUE INDEX "classrooms_organizationId_code_key" ON "classrooms"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "classroom_availability_classroomId_weekday_lessonNumber_key" ON "classroom_availability"("classroomId", "weekday", "lessonNumber");

-- CreateIndex
CREATE INDEX "calendar_events_organizationId_startDate_endDate_idx" ON "calendar_events"("organizationId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "calendar_events_educationalProgramId_idx" ON "calendar_events"("educationalProgramId");

-- CreateIndex
CREATE INDEX "assessment_events_studentGroupId_date_idx" ON "assessment_events"("studentGroupId", "date");

-- CreateIndex
CREATE INDEX "schedule_periods_organizationId_idx" ON "schedule_periods"("organizationId");

-- CreateIndex
CREATE INDEX "schedule_lessons_date_lessonNumber_idx" ON "schedule_lessons"("date", "lessonNumber");

-- CreateIndex
CREATE INDEX "schedule_lessons_schedulePeriodId_date_idx" ON "schedule_lessons"("schedulePeriodId", "date");

-- CreateIndex
CREATE INDEX "schedule_lessons_studentGroupId_date_idx" ON "schedule_lessons"("studentGroupId", "date");

-- CreateIndex
CREATE INDEX "schedule_lessons_teacherId_date_idx" ON "schedule_lessons"("teacherId", "date");

-- CreateIndex
CREATE INDEX "schedule_lessons_classroomId_date_idx" ON "schedule_lessons"("classroomId", "date");

-- CreateIndex
CREATE INDEX "schedule_lessons_semesterCurriculumItemId_idx" ON "schedule_lessons"("semesterCurriculumItemId");

-- CreateIndex
CREATE UNIQUE INDEX "conducted_lessons_scheduleLessonId_key" ON "conducted_lessons"("scheduleLessonId");

-- CreateIndex
CREATE INDEX "conducted_lessons_actualTeacherId_idx" ON "conducted_lessons"("actualTeacherId");

-- CreateIndex
CREATE INDEX "teacher_substitutions_scheduleLessonId_idx" ON "teacher_substitutions"("scheduleLessonId");

-- CreateIndex
CREATE INDEX "makeup_tasks_status_idx" ON "makeup_tasks"("status");

-- CreateIndex
CREATE INDEX "schedule_generation_jobs_schedulePeriodId_createdAt_idx" ON "schedule_generation_jobs"("schedulePeriodId", "createdAt");

-- CreateIndex
CREATE INDEX "validation_results_schedulePeriodId_severity_idx" ON "validation_results"("schedulePeriodId", "severity");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_times" ADD CONSTRAINT "lesson_times_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_studentGroupId_fkey" FOREIGN KEY ("studentGroupId") REFERENCES "student_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "educational_programs" ADD CONSTRAINT "educational_programs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "educational_programs" ADD CONSTRAINT "educational_programs_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "specialties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_educationalProgramId_fkey" FOREIGN KEY ("educationalProgramId") REFERENCES "educational_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semesters" ADD CONSTRAINT "semesters_educationalProgramId_fkey" FOREIGN KEY ("educationalProgramId") REFERENCES "educational_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semesters" ADD CONSTRAINT "semesters_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_groups" ADD CONSTRAINT "student_groups_educationalProgramId_fkey" FOREIGN KEY ("educationalProgramId") REFERENCES "educational_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subgroups" ADD CONSTRAINT "subgroups_studentGroupId_fkey" FOREIGN KEY ("studentGroupId") REFERENCES "student_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_studentGroupId_fkey" FOREIGN KEY ("studentGroupId") REFERENCES "student_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_subgroupId_fkey" FOREIGN KEY ("subgroupId") REFERENCES "subgroups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_cycles" ADD CONSTRAINT "curriculum_cycles_educationalProgramId_fkey" FOREIGN KEY ("educationalProgramId") REFERENCES "educational_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_items" ADD CONSTRAINT "curriculum_items_educationalProgramId_fkey" FOREIGN KEY ("educationalProgramId") REFERENCES "educational_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_items" ADD CONSTRAINT "curriculum_items_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "curriculum_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_items" ADD CONSTRAINT "curriculum_items_parentItemId_fkey" FOREIGN KEY ("parentItemId") REFERENCES "curriculum_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semester_curriculum_items" ADD CONSTRAINT "semester_curriculum_items_curriculumItemId_fkey" FOREIGN KEY ("curriculumItemId") REFERENCES "curriculum_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semester_curriculum_items" ADD CONSTRAINT "semester_curriculum_items_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "semesters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_curriculum_assignments" ADD CONSTRAINT "group_curriculum_assignments_studentGroupId_fkey" FOREIGN KEY ("studentGroupId") REFERENCES "student_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_curriculum_assignments" ADD CONSTRAINT "group_curriculum_assignments_semesterCurriculumItemId_fkey" FOREIGN KEY ("semesterCurriculumItemId") REFERENCES "semester_curriculum_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_curriculum_assignments" ADD CONSTRAINT "group_curriculum_assignments_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_curriculum_assignments" ADD CONSTRAINT "group_curriculum_assignments_preferredClassroomId_fkey" FOREIGN KEY ("preferredClassroomId") REFERENCES "classrooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_availability" ADD CONSTRAINT "teacher_availability_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_availability" ADD CONSTRAINT "classroom_availability_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_educationalProgramId_fkey" FOREIGN KEY ("educationalProgramId") REFERENCES "educational_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "semesters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_studentGroupId_fkey" FOREIGN KEY ("studentGroupId") REFERENCES "student_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_events" ADD CONSTRAINT "assessment_events_studentGroupId_fkey" FOREIGN KEY ("studentGroupId") REFERENCES "student_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_events" ADD CONSTRAINT "assessment_events_semesterCurriculumItemId_fkey" FOREIGN KEY ("semesterCurriculumItemId") REFERENCES "semester_curriculum_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_events" ADD CONSTRAINT "assessment_events_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_events" ADD CONSTRAINT "assessment_events_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "classrooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_periods" ADD CONSTRAINT "schedule_periods_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_periods" ADD CONSTRAINT "schedule_periods_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_periods" ADD CONSTRAINT "schedule_periods_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "semesters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_lessons" ADD CONSTRAINT "schedule_lessons_schedulePeriodId_fkey" FOREIGN KEY ("schedulePeriodId") REFERENCES "schedule_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_lessons" ADD CONSTRAINT "schedule_lessons_studentGroupId_fkey" FOREIGN KEY ("studentGroupId") REFERENCES "student_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_lessons" ADD CONSTRAINT "schedule_lessons_semesterCurriculumItemId_fkey" FOREIGN KEY ("semesterCurriculumItemId") REFERENCES "semester_curriculum_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_lessons" ADD CONSTRAINT "schedule_lessons_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "group_curriculum_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_lessons" ADD CONSTRAINT "schedule_lessons_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_lessons" ADD CONSTRAINT "schedule_lessons_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "classrooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_lessons" ADD CONSTRAINT "schedule_lessons_originalLessonId_fkey" FOREIGN KEY ("originalLessonId") REFERENCES "schedule_lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conducted_lessons" ADD CONSTRAINT "conducted_lessons_scheduleLessonId_fkey" FOREIGN KEY ("scheduleLessonId") REFERENCES "schedule_lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conducted_lessons" ADD CONSTRAINT "conducted_lessons_actualTeacherId_fkey" FOREIGN KEY ("actualTeacherId") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conducted_lessons" ADD CONSTRAINT "conducted_lessons_actualClassroomId_fkey" FOREIGN KEY ("actualClassroomId") REFERENCES "classrooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conducted_lessons" ADD CONSTRAINT "conducted_lessons_replacementLessonId_fkey" FOREIGN KEY ("replacementLessonId") REFERENCES "schedule_lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_substitutions" ADD CONSTRAINT "teacher_substitutions_scheduleLessonId_fkey" FOREIGN KEY ("scheduleLessonId") REFERENCES "schedule_lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_substitutions" ADD CONSTRAINT "teacher_substitutions_originalTeacherId_fkey" FOREIGN KEY ("originalTeacherId") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_substitutions" ADD CONSTRAINT "teacher_substitutions_substituteTeacherId_fkey" FOREIGN KEY ("substituteTeacherId") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_substitutions" ADD CONSTRAINT "teacher_substitutions_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "makeup_tasks" ADD CONSTRAINT "makeup_tasks_sourceLessonId_fkey" FOREIGN KEY ("sourceLessonId") REFERENCES "schedule_lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "makeup_tasks" ADD CONSTRAINT "makeup_tasks_resolvedLessonId_fkey" FOREIGN KEY ("resolvedLessonId") REFERENCES "schedule_lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "makeup_tasks" ADD CONSTRAINT "makeup_tasks_studentGroupId_fkey" FOREIGN KEY ("studentGroupId") REFERENCES "student_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "makeup_tasks" ADD CONSTRAINT "makeup_tasks_semesterCurriculumItemId_fkey" FOREIGN KEY ("semesterCurriculumItemId") REFERENCES "semester_curriculum_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "makeup_tasks" ADD CONSTRAINT "makeup_tasks_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_generation_jobs" ADD CONSTRAINT "schedule_generation_jobs_schedulePeriodId_fkey" FOREIGN KEY ("schedulePeriodId") REFERENCES "schedule_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_generation_jobs" ADD CONSTRAINT "schedule_generation_jobs_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_results" ADD CONSTRAINT "validation_results_schedulePeriodId_fkey" FOREIGN KEY ("schedulePeriodId") REFERENCES "schedule_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_results" ADD CONSTRAINT "validation_results_educationalProgramId_fkey" FOREIGN KEY ("educationalProgramId") REFERENCES "educational_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_scheduleLessonId_fkey" FOREIGN KEY ("scheduleLessonId") REFERENCES "schedule_lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
