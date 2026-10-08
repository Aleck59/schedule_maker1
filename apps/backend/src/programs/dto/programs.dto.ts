import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { ClassroomType, ControlForm, CurriculumItemType, ProgramStatus, StudyForm } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { DATE_MESSAGE, DATE_REGEX } from '../../common/dto/date-range.dto';

export class CreateProgramDto {
  @ApiProperty()
  @IsUUID('4', { message: 'Укажите специальность' })
  specialtyId: string;

  @ApiProperty({ example: '09.02.07 ИСиП, набор 2024' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите название учебного плана' })
  title: string;

  @ApiProperty({ example: 2024 })
  @IsInt()
  @Min(2000)
  @Max(2100)
  admissionYear: number;

  @ApiPropertyOptional({ enum: StudyForm, default: StudyForm.FULL_TIME })
  @IsOptional()
  @IsEnum(StudyForm)
  studyForm?: StudyForm;

  @ApiProperty({ example: 46 })
  @IsInt()
  @Min(1)
  @Max(120)
  durationMonths: number;

  @ApiProperty({ example: 8 })
  @IsInt()
  @Min(1)
  @Max(12)
  totalSemesters: number;

  @ApiPropertyOptional({ enum: ProgramStatus })
  @IsOptional()
  @IsEnum(ProgramStatus)
  status?: ProgramStatus;

  @ApiPropertyOptional({
    description: 'Автоматически создать учебные годы и семестры (сентябрь–декабрь, январь–июнь)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  generateStructure?: boolean;
}

export class UpdateProgramDto extends PartialType(
  OmitType(CreateProgramDto, ['generateStructure'] as const),
) {}

export class CreateAcademicYearDto {
  @ApiProperty({ example: '2025–2026' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите название учебного года' })
  title: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  courseNumber?: number;

  @ApiProperty({ example: '2025-09-01' })
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  startDate: string;

  @ApiProperty({ example: '2026-08-31' })
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  endDate: string;
}

export class UpdateAcademicYearDto extends PartialType(CreateAcademicYearDto) {}

export class CreateSemesterDto {
  @ApiProperty()
  @IsUUID('4', { message: 'Укажите учебный год' })
  academicYearId: string;

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  @Max(12)
  number: number;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  @Max(6)
  courseNumber: number;

  @ApiProperty({ example: '2025-09-01' })
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  startDate: string;

  @ApiProperty({ example: '2025-12-31' })
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  endDate: string;

  @ApiPropertyOptional({ example: 16 })
  @IsOptional()
  @IsInt()
  @Min(0)
  theoreticalWeeks?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  examWeeks?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  vacationWeeks?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  practiceWeeks?: number;
}

export class UpdateSemesterDto extends PartialType(CreateSemesterDto) {}

export class CreateCycleDto {
  @ApiProperty({ example: 'ОП' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите код цикла' })
  code: string;

  @ApiProperty({ example: 'Общепрофессиональный цикл' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите наименование цикла' })
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateCycleDto extends PartialType(CreateCycleDto) {}

/** Часы элемента плана в семестре */
export class SemesterHoursDto {
  @ApiPropertyOptional({ description: 'ID семестра (или номер семестра semesterNumber)' })
  @IsOptional()
  @IsUUID()
  semesterId?: string;

  @ApiPropertyOptional({ example: 3 })
  @ValidateIf((o: SemesterHoursDto) => !o.semesterId)
  @IsInt({ message: 'Укажите семестр' })
  @Min(1)
  @Max(12)
  semesterNumber?: number;

  @ApiPropertyOptional({ description: 'Если не указано — рассчитывается как сумма всех видов часов' })
  @IsOptional()
  @IsInt()
  @Min(0)
  totalHours?: number;

  @ApiPropertyOptional({ example: 34 })
  @IsOptional()
  @IsInt()
  @Min(0)
  lectureHours?: number;

  @ApiPropertyOptional({ example: 34 })
  @IsOptional()
  @IsInt()
  @Min(0)
  practicalHours?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  laboratoryHours?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  consultationHours?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @Min(0)
  selfStudyHours?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  assessmentHours?: number;

  @ApiPropertyOptional({ example: 0, description: 'Часы практики на базе колледжа' })
  @IsOptional()
  @IsInt()
  @Min(0)
  practiceHours?: number;

  @ApiPropertyOptional({ enum: ControlForm })
  @IsOptional()
  @IsEnum(ControlForm)
  controlForm?: ControlForm;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  practiceAtCollege?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  scheduleConsultations?: boolean;

  @ApiPropertyOptional({ enum: ClassroomType, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(ClassroomType, { each: true })
  lectureRoomTypes?: ClassroomType[];

  @ApiPropertyOptional({ enum: ClassroomType, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(ClassroomType, { each: true })
  practicalRoomTypes?: ClassroomType[];

  @ApiPropertyOptional({ enum: ClassroomType, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(ClassroomType, { each: true })
  laboratoryRoomTypes?: ClassroomType[];

  @ApiPropertyOptional({ enum: ClassroomType, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(ClassroomType, { each: true })
  consultationRoomTypes?: ClassroomType[];

  @ApiPropertyOptional({ enum: ClassroomType, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(ClassroomType, { each: true })
  practiceRoomTypes?: ClassroomType[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateSemesterItemDto extends PartialType(
  OmitType(SemesterHoursDto, ['semesterId', 'semesterNumber'] as const),
) {}

export class CreateCurriculumItemDto {
  @ApiProperty()
  @IsUUID('4', { message: 'Укажите цикл учебного плана' })
  cycleId: string;

  @ApiPropertyOptional({ description: 'Родительский элемент (для МДК и практик — профессиональный модуль)' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  parentItemId?: string | null;

  @ApiProperty({ example: 'ОП.04' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите индекс дисциплины' })
  code: string;

  @ApiProperty({ example: 'Основы алгоритмизации и программирования' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите наименование' })
  name: string;

  @ApiProperty({ enum: CurriculumItemType })
  @IsEnum(CurriculumItemType, { message: 'Недопустимый тип элемента учебного плана' })
  itemType: CurriculumItemType;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDifficult?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ type: [SemesterHoursDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SemesterHoursDto)
  semesters?: SemesterHoursDto[];
}

export class UpdateCurriculumItemDto extends PartialType(CreateCurriculumItemDto) {}
