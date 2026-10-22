-- CreateEnum
CREATE TYPE "EducationBase" AS ENUM ('BASIC_GENERAL', 'SECONDARY_GENERAL');

-- AlterTable
ALTER TABLE "educational_programs" ADD COLUMN     "educationBase" "EducationBase";

-- AlterTable
ALTER TABLE "organization_settings" ADD COLUMN     "printFormJson" JSONB;

