import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AcademicDegree, AcademicTitle, EducationLevel, TeacherEducation } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { DATE_MESSAGE, DATE_REGEX } from '../../common/dto/date-range.dto';

export class CreateTeacherDto {
  @ApiProperty({ example: 'Петров Алексей Сергеевич' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите ФИО преподавателя' })
  fullName: string;

  @ApiPropertyOptional({ example: 'Цикловая комиссия информационных технологий' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ example: 'Преподаватель высшей категории' })
  @IsOptional()
  @IsString()
  position?: string;

  @ApiPropertyOptional({ example: 'petrov@college.ru' })
  @IsOptional()
  @IsEmail({}, { message: 'Укажите корректный email' })
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 18 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  maxWeeklyLessons?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  maxDailyLessons?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  preferredStartLesson?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  preferredEndLesson?: number;

  @ApiPropertyOptional({
    enum: TeacherEducation,
    nullable: true,
    description: 'Образование: от него зависит, у каких уровней (СПО, бакалавриат…) можно вести занятия',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsEnum(TeacherEducation, { message: 'Некорректный уровень образования преподавателя' })
  educationLevel?: TeacherEducation | null;

  @ApiPropertyOptional({ enum: AcademicDegree, default: AcademicDegree.NONE })
  @IsOptional()
  @IsEnum(AcademicDegree, { message: 'Некорректная учёная степень' })
  academicDegree?: AcademicDegree;

  @ApiPropertyOptional({ enum: AcademicTitle, default: AcademicTitle.NONE })
  @IsOptional()
  @IsEnum(AcademicTitle, { message: 'Некорректное учёное звание' })
  academicTitle?: AcademicTitle;

  @ApiPropertyOptional({
    enum: EducationLevel,
    isArray: true,
    description: 'Уровни, у которых может вести занятия, вручную (пусто — по образованию, степени и званию)',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(EducationLevel, { each: true, message: 'Некорректный уровень образования' })
  teachableLevels?: EducationLevel[];

  @ApiPropertyOptional({
    example: '2026-11-01',
    nullable: true,
    description: 'Дата начала работы: раньше неё занятия преподавателю не ставятся',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  employedFrom?: string | null;

  @ApiPropertyOptional({
    example: '2027-06-30',
    nullable: true,
    description: 'Дата окончания работы (увольнение, окончание договора)',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  employedTo?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTeacherDto extends PartialType(CreateTeacherDto) {}
