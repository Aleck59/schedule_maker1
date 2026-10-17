-- CreateEnum
CREATE TYPE "TeacherEducation" AS ENUM ('SPO', 'BACHELOR', 'SPECIALIST', 'MASTER', 'HIGHEST');

-- CreateEnum
CREATE TYPE "AcademicDegree" AS ENUM ('NONE', 'CANDIDATE', 'DOCTOR');

-- CreateEnum
CREATE TYPE "AcademicTitle" AS ENUM ('NONE', 'DOCENT', 'PROFESSOR');

-- AlterTable
ALTER TABLE "teachers" ADD COLUMN     "academicDegree" "AcademicDegree" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "academicTitle" "AcademicTitle" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "educationLevel" "TeacherEducation",
ADD COLUMN     "employedFrom" DATE,
ADD COLUMN     "employedTo" DATE,
ADD COLUMN     "photo" BYTEA,
ADD COLUMN     "photoMime" TEXT,
ADD COLUMN     "photoUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "teachableLevels" "EducationLevel"[] DEFAULT ARRAY[]::"EducationLevel"[];
