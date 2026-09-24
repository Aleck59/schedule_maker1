import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { ClassroomType, LessonType } from '@prisma/client';
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min, ValidateIf } from 'class-validator';

export class CreateAssignmentDto {
  @ApiProperty()
  @IsUUID('4', { message: 'Укажите группу' })
  studentGroupId: string;

  @ApiProperty({ description: 'Дисциплина семестра (SemesterCurriculumItem)' })
  @IsUUID('4', { message: 'Укажите дисциплину семестра' })
  semesterCurriculumItemId: string;

  @ApiPropertyOptional({ nullable: true, description: 'Номер подгруппы; пусто — вся группа' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(6)
  subgroupNumber?: number | null;

  @ApiPropertyOptional({ enum: LessonType, nullable: true, description: 'Пусто — все виды занятий' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsEnum(LessonType)
  lessonType?: LessonType | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  teacherId?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 2, description: 'Желаемое количество пар в неделю' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(12)
  weeklyLessonTarget?: number | null;

  @ApiPropertyOptional({ example: 5, description: 'Приоритет постановки 1..10' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  priority?: number;

  @ApiPropertyOptional({ nullable: true, description: 'Переопределение плановых часов' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  plannedHours?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  preferredClassroomId?: string | null;

  @ApiPropertyOptional({ enum: ClassroomType, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(ClassroomType, { each: true })
  classroomTypes?: ClassroomType[];

  @ApiPropertyOptional({ nullable: true, description: 'Ключ потока для объединения групп' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  streamKey?: string | null;

  @ApiPropertyOptional({ description: 'Разрешить превышение плановых часов' })
  @IsOptional()
  @IsBoolean()
  allowHoursExcess?: boolean;
}

export class UpdateAssignmentDto extends PartialType(
  OmitType(CreateAssignmentDto, ['studentGroupId', 'semesterCurriculumItemId'] as const),
) {}

export class GenerateAssignmentsDto {
  @ApiProperty()
  @IsUUID('4', { message: 'Укажите группу' })
  studentGroupId: string;

  @ApiProperty()
  @IsUUID('4', { message: 'Укажите семестр' })
  semesterId: string;
}
