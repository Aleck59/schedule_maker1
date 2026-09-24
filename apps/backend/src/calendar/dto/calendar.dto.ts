import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CalendarEventType, ControlForm } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, Min, ValidateIf } from 'class-validator';
import { DATE_MESSAGE, DATE_REGEX } from '../../common/dto/date-range.dto';

export class CreateCalendarEventDto {
  @ApiPropertyOptional({ nullable: true, description: 'Учебный план; пусто — для всей организации' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  educationalProgramId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  semesterId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  studentGroupId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Курс, для которого действует период' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(6)
  courseNumber?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Недоступность конкретного преподавателя' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  teacherId?: string | null;

  @ApiProperty({ enum: CalendarEventType })
  @IsEnum(CalendarEventType, { message: 'Недопустимый тип периода' })
  eventType: CalendarEventType;

  @ApiProperty({ example: 'Зимние каникулы' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите название периода' })
  title: string;

  @ApiProperty({ example: '2025-12-31' })
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  startDate: string;

  @ApiProperty({ example: '2026-01-11' })
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  endDate: string;

  @ApiPropertyOptional({ description: 'Блокирует постановку обычных занятий (по умолчанию — да, кроме теоретического обучения)' })
  @IsOptional()
  @IsBoolean()
  blocksSchedule?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateCalendarEventDto extends PartialType(CreateCalendarEventDto) {}

export class SetWeekTypeDto {
  @ApiProperty({ example: '2025-10-06', description: 'Любая дата недели (будет взят понедельник)' })
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  weekStart: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(6)
  courseNumber?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  studentGroupId?: string | null;

  @ApiPropertyOptional({ enum: CalendarEventType, nullable: true, description: 'null — очистить неделю' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsEnum(CalendarEventType)
  eventType?: CalendarEventType | null;
}

export class CreateAssessmentDto {
  @ApiProperty()
  @IsUUID('4', { message: 'Укажите группу' })
  studentGroupId: string;

  @ApiProperty()
  @IsUUID('4', { message: 'Укажите дисциплину семестра' })
  semesterCurriculumItemId: string;

  @ApiPropertyOptional({ enum: ControlForm })
  @IsOptional()
  @IsEnum(ControlForm)
  controlForm?: ControlForm;

  @ApiProperty({ example: '2025-12-24' })
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  date: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  lessonNumber?: number;

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
  @IsString()
  notes?: string;
}

export class AutoPlaceAssessmentsDto {
  @ApiProperty()
  @IsUUID('4', { message: 'Укажите семестр' })
  semesterId: string;

  @ApiPropertyOptional({ description: 'Группа; пусто — все группы учебного плана' })
  @IsOptional()
  @IsUUID()
  studentGroupId?: string;

  @ApiPropertyOptional({ example: 2, description: 'Минимум дней между экзаменами' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(7)
  minDaysBetween?: number;
}
