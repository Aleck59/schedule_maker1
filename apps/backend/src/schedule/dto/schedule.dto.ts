import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CancellationReason,
  ConductedStatus,
  LessonStatus,
  LessonType,
  MakeupTaskStatus,
  SchedulePeriodStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
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

export class CreatePeriodDto {
  @ApiProperty({ description: 'Семестр учебного плана' })
  @IsUUID('4', { message: 'Укажите семестр' })
  semesterId: string;

  @ApiPropertyOptional({ description: 'По умолчанию — учебный год семестра' })
  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @ApiProperty({ example: 'ИСиП-2024: 3 семестр (осень 2025)' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите название периода' })
  title: string;

  @ApiPropertyOptional({ example: '2025-09-01', description: 'По умолчанию — дата начала семестра' })
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  startDate?: string;

  @ApiPropertyOptional({ example: '2025-12-31' })
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdatePeriodDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  endDate?: string;

  @ApiPropertyOptional({ enum: SchedulePeriodStatus, description: 'Для публикации используйте /publish' })
  @IsOptional()
  @IsEnum(SchedulePeriodStatus)
  status?: SchedulePeriodStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ClearPeriodDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  groupIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  to?: string;

  @ApiPropertyOptional({ default: true, description: 'Удалять только сгенерированные (не ручные) занятия' })
  @IsOptional()
  @IsBoolean()
  onlyGenerated?: boolean;
}

export class LessonQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  periodId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  classroomId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  semesterItemId?: string;

  @ApiPropertyOptional({ example: '2025-09-01' })
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  from?: string;

  @ApiPropertyOptional({ example: '2025-09-07' })
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  to?: string;

  @ApiPropertyOptional({ enum: LessonStatus, isArray: true })
  @IsOptional()
  @IsEnum(LessonStatus, { each: true })
  status?: LessonStatus | LessonStatus[];

  @ApiPropertyOptional({ description: 'Не показывать отменённые и перенесённые' })
  @IsOptional()
  @IsIn(['true', 'false'])
  activeOnly?: string;
}

export class CreateLessonDto {
  @ApiProperty()
  @IsUUID('4', { message: 'Укажите период расписания' })
  schedulePeriodId: string;

  @ApiProperty({ example: '2025-09-02' })
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  date: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  @Max(12)
  lessonNumber: number;

  @ApiProperty()
  @IsUUID('4', { message: 'Укажите группу' })
  studentGroupId: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  subgroupNumber?: number | null;

  @ApiProperty()
  @IsUUID('4', { message: 'Укажите дисциплину' })
  semesterCurriculumItemId: string;

  @ApiProperty({ enum: LessonType })
  @IsEnum(LessonType, { message: 'Недопустимый вид занятия' })
  lessonType: LessonType;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  teacherId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  classroomId?: string | null;

  @ApiPropertyOptional({ example: 2, description: 'Академических часов (1 — неполная пара)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  academicHours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  topic?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Разрешить превышение плановых часов' })
  @IsOptional()
  @IsBoolean()
  allowHoursExcess?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  streamKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isLocked?: boolean;

  @ApiPropertyOptional({ description: 'Задача отработки, которую закрывает это занятие' })
  @IsOptional()
  @IsUUID()
  makeupTaskId?: string;

  @ApiPropertyOptional({ description: 'Сохранить несмотря на конфликты' })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class UpdateLessonDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  lessonNumber?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  subgroupNumber?: number | null;

  @ApiPropertyOptional({ enum: LessonType })
  @IsOptional()
  @IsEnum(LessonType)
  lessonType?: LessonType;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  teacherId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  classroomId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  academicHours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  topic?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowHoursExcess?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isLocked?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class MoveLessonDto {
  @ApiProperty({ example: '2025-09-03' })
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  date: string;

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  @Max(12)
  lessonNumber: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  classroomId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    enum: ['auto', 'inplace', 'history'],
    description:
      'inplace — изменить занятие; history — пометить исходное как перенесённое и создать новое; auto — history для опубликованного расписания или прошедших дат',
  })
  @IsOptional()
  @IsIn(['auto', 'inplace', 'history'])
  mode?: 'auto' | 'inplace' | 'history';

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class CancelLessonDto {
  @ApiProperty({ enum: CancellationReason })
  @IsEnum(CancellationReason, { message: 'Укажите причину отмены' })
  reason: CancellationReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ default: true, description: 'Создать задачу «требуется отработка»' })
  @IsOptional()
  @IsBoolean()
  createMakeupTask?: boolean;
}

export class SubstituteDto {
  @ApiProperty()
  @IsUUID('4', { message: 'Укажите заменяющего преподавателя' })
  substituteTeacherId: string;

  @ApiPropertyOptional({ example: 'Болезнь преподавателя' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class MarkConductedDto {
  @ApiPropertyOptional({ enum: ConductedStatus, default: ConductedStatus.CONDUCTED })
  @IsOptional()
  @IsEnum(ConductedStatus)
  status?: ConductedStatus;

  @ApiPropertyOptional({
    description: 'Фактически проведено ак. часов (меньше плановых — проведено частично)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8)
  actualHours?: number;

  @ApiPropertyOptional({ description: 'Фактический преподаватель (если провёл заменяющий)' })
  @IsOptional()
  @IsUUID()
  actualTeacherId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  actualClassroomId?: string;

  @ApiPropertyOptional({ enum: CancellationReason })
  @IsOptional()
  @IsEnum(CancellationReason)
  cancellationReason?: CancellationReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  topic?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Для статуса POSTPONED — новая дата' })
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  newDate?: string;

  @ApiPropertyOptional({ description: 'Для статуса POSTPONED — новый номер пары' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  newLessonNumber?: number;

  @ApiPropertyOptional({ description: 'Для статуса REPLACED — занятие, которое проведено вместо' })
  @IsOptional()
  @IsUUID()
  replacementLessonId?: string;
}

export class CopyLessonDto {
  @ApiProperty()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  date: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(12)
  lessonNumber: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  classroomId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class BulkPatchDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  teacherId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  classroomId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  lessonNumber?: number;

  @ApiPropertyOptional({ description: 'Сдвиг даты в днях' })
  @IsOptional()
  @IsInt()
  @Min(-60)
  @Max(60)
  shiftDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  topic?: string;
}

export class BulkLessonsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Не выбраны занятия' })
  @IsUUID('4', { each: true })
  ids: string[];

  @ApiProperty({ enum: ['update', 'delete', 'lock', 'unlock', 'cancel'] })
  @IsIn(['update', 'delete', 'lock', 'unlock', 'cancel'], { message: 'Недопустимое действие' })
  action: 'update' | 'delete' | 'lock' | 'unlock' | 'cancel';

  @ApiPropertyOptional({ type: BulkPatchDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BulkPatchDto)
  patch?: BulkPatchDto;

  @ApiPropertyOptional({ enum: CancellationReason })
  @IsOptional()
  @IsEnum(CancellationReason)
  reason?: CancellationReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class CheckLessonDto {
  @ApiPropertyOptional({ description: 'Существующее занятие (для проверки переноса/изменения)' })
  @IsOptional()
  @IsUUID()
  lessonId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  schedulePeriodId?: string;

  @ApiProperty()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  date: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(12)
  lessonNumber: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentGroupId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  subgroupNumber?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  semesterCurriculumItemId?: string;

  @ApiPropertyOptional({ enum: LessonType })
  @IsOptional()
  @IsEnum(LessonType)
  lessonType?: LessonType;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  teacherId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  classroomId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  academicHours?: number;
}

export class UpdateMakeupTaskDto {
  @ApiPropertyOptional({ enum: MakeupTaskStatus })
  @IsOptional()
  @IsEnum(MakeupTaskStatus)
  status?: MakeupTaskStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ScheduleMakeupDto {
  @ApiProperty()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  date: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(12)
  lessonNumber: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  classroomId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class ReplaceLessonsDto {
  @ApiProperty({ type: [CreateLessonDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateLessonDto)
  lessons: CreateLessonDto[];
}
