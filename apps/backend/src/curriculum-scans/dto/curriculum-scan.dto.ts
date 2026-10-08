import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CalendarEventType, ControlForm, StudyForm } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DATE_MESSAGE, DATE_REGEX } from '../../common/dto/date-range.dto';

/** Виды строк распознанного плана */
export const SCAN_ITEM_KINDS = [
  'DISCIPLINE',
  'GROUP',
  'MODULE',
  'MODULE_EXAM',
  'INTERDISCIPLINARY_COURSE',
  'EDUCATIONAL_PRACTICE',
  'INDUSTRIAL_PRACTICE',
  'PRE_DIPLOMA_PRACTICE',
  'FINAL_ATTESTATION',
  'ELECTIVE',
] as const;
export type ScanItemKind = (typeof SCAN_ITEM_KINDS)[number];

export class ScanSpecialtyDto {
  @ApiProperty({ example: '40.02.04' })
  @Matches(/^\d{2}\.\d{2}\.\d{2}$/, { message: 'Код специальности в формате 00.00.00' })
  code: string;

  @ApiProperty({ example: 'Юриспруденция' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите наименование специальности' })
  @MaxLength(300)
  name: string;

  @ApiProperty({ example: 'Юрист' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите квалификацию' })
  @MaxLength(300)
  qualification: string;

  @ApiPropertyOptional({ example: '798' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  fgosNumber?: string;

  @ApiPropertyOptional({ example: '2023-10-27' })
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  fgosDate?: string;
}

export class ScanProgramDto {
  @ApiPropertyOptional({ example: '40.02.04 Юриспруденция, набор 2026' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @ApiProperty({ example: 2026 })
  @IsInt()
  @Min(2000)
  @Max(2100)
  admissionYear: number;

  @ApiProperty({ enum: StudyForm })
  @IsEnum(StudyForm)
  studyForm: StudyForm;

  @ApiProperty({ example: 34 })
  @IsInt()
  @Min(1)
  @Max(120)
  durationMonths: number;
}

export class ScanSemesterDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(12)
  number: number;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(6)
  course: number;

  @ApiProperty({ example: '2026-09-01' })
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  startDate: string;

  @ApiProperty({ example: '2027-02-07' })
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  endDate: string;

  @ApiPropertyOptional({ example: 18.8 })
  @IsOptional()
  @Min(0)
  @Max(53)
  theoryWeeks?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Min(0)
  @Max(53)
  examWeeks?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Min(0)
  @Max(53)
  vacationWeeks?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Min(0)
  @Max(53)
  practiceWeeks?: number;
}

export class ScanPeriodDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(6)
  course: number;

  @ApiProperty({ enum: CalendarEventType })
  @IsEnum(CalendarEventType)
  type: CalendarEventType;

  @ApiProperty({ example: '2027-01-11' })
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  startDate: string;

  @ApiProperty({ example: '2027-01-23' })
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  endDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}

export class ScanCycleDto {
  @ApiProperty({ example: 'СГ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  code: string;

  @ApiProperty({ example: 'Социально-гуманитарный цикл' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  name: string;
}

export class ScanHoursDto {
  @ApiProperty() @IsInt() @Min(0) @Max(5000) total: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(5000) contact?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(5000) lecture?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(5000) laboratory?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(5000) practical?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(5000) seminar?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(5000) individualProject?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(5000) selfStudy?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(5000) assessment?: number;
}

export class ScanItemSemesterDto {
  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  @Max(12)
  number: number;

  @ApiProperty({ enum: ControlForm })
  @IsEnum(ControlForm)
  controlForm: ControlForm;

  @ApiProperty({ type: ScanHoursDto })
  @ValidateNested()
  @Type(() => ScanHoursDto)
  hours: ScanHoursDto;

  @ApiPropertyOptional({ description: 'Практика проводится на базе колледжа (ставится в расписание)' })
  @IsOptional()
  @IsBoolean()
  practiceAtCollege?: boolean;
}

export class ScanItemDto {
  @ApiProperty({ example: 'СГ.01' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите индекс' })
  @MaxLength(30)
  code: string;

  @ApiProperty({ example: 'История России' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите наименование' })
  @MaxLength(400)
  name: string;

  @ApiProperty({ enum: SCAN_ITEM_KINDS })
  @IsIn(SCAN_ITEM_KINDS as unknown as string[], { message: 'Неизвестный вид строки учебного плана' })
  kind: ScanItemKind;

  @ApiProperty({ example: 'СГ' })
  @IsString()
  @IsNotEmpty()
  cycleCode: string;

  @ApiPropertyOptional({ example: 'ПМ.01' })
  @IsOptional()
  @IsString()
  parentCode?: string | null;

  @ApiPropertyOptional({ default: true, description: 'Импортировать строку' })
  @IsOptional()
  @IsBoolean()
  include?: boolean;

  @ApiPropertyOptional({ description: '«Сложная» дисциплина' })
  @IsOptional()
  @IsBoolean()
  isDifficult?: boolean;

  @ApiProperty({ type: [ScanItemSemesterDto] })
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ScanItemSemesterDto)
  semesters: ScanItemSemesterDto[];
}

export class ScanGroupDto {
  @ApiProperty({ example: 'Ю-26-1' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите код группы' })
  @MaxLength(50)
  code: string;

  @ApiProperty({ example: 25 })
  @IsInt()
  @Min(1)
  @Max(500)
  studentCount: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  subgroupCount?: number;
}

/** Проверенные администратором данные скана — по ним создаются учебный план и связанные сущности */
export class ApplyScanDto {
  @ApiProperty({ type: ScanSpecialtyDto })
  @ValidateNested()
  @Type(() => ScanSpecialtyDto)
  specialty: ScanSpecialtyDto;

  @ApiProperty({ type: ScanProgramDto })
  @ValidateNested()
  @Type(() => ScanProgramDto)
  program: ScanProgramDto;

  @ApiProperty({ type: [ScanSemesterDto] })
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ScanSemesterDto)
  semesters: ScanSemesterDto[];

  @ApiProperty({ type: [ScanPeriodDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ScanPeriodDto)
  periods: ScanPeriodDto[];

  @ApiProperty({ type: [ScanCycleDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ScanCycleDto)
  cycles: ScanCycleDto[];

  @ApiProperty({ type: [ScanItemDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ScanItemDto)
  items: ScanItemDto[];

  @ApiPropertyOptional({ type: ScanGroupDto, description: 'Сразу создать учебную группу по плану' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ScanGroupDto)
  group?: ScanGroupDto;
}
