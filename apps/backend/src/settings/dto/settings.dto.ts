import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpdateSettingsDto {
  @ApiPropertyOptional({ example: 2, description: 'Академических часов в паре' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  academicHoursPerLesson?: number;

  @ApiPropertyOptional({ example: 45 })
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(90)
  academicHourMinutes?: number;

  @ApiPropertyOptional({ example: 90 })
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(240)
  lessonDurationMinutes?: number;

  @ApiPropertyOptional({ example: 6, description: 'Количество пар в день' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  lessonsPerDay?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxGroupLessonsPerDay?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  maxSameDisciplinePerDay?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxSameDisciplinePerWeek?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(11)
  lateLessonNumber?: number;

  @ApiPropertyOptional({ example: [1, 2, 3, 4, 5, 6], type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Нужен хотя бы один учебный день недели' })
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  workingDays?: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  maxGroupWindowsPerWeek?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  maxTeacherWindowsPerWeek?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxExamsPerWeek?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  maxBuildingChangesPerDay?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  warnOnPartialLessons?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  scheduleConsultations?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  consultationWeeksBeforeEnd?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(3600)
  solverTimeLimitSeconds?: number;

  @ApiPropertyOptional({ description: 'Веса мягких ограничений' })
  @IsOptional()
  @IsObject()
  solverWeightsJson?: Record<string, number>;
}

export class UpdateOrganizationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shortName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Europe/Moscow' })
  @IsOptional()
  @IsString()
  timezone?: string;
}

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export class LessonTimeDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(12)
  lessonNumber: number;

  @ApiProperty({ example: '08:30' })
  @Matches(TIME_REGEX, { message: 'Время должно быть в формате ЧЧ:ММ' })
  startTime: string;

  @ApiProperty({ example: '10:00' })
  @Matches(TIME_REGEX, { message: 'Время должно быть в формате ЧЧ:ММ' })
  endTime: string;
}

export class ReplaceLessonTimesDto {
  @ApiProperty({ type: [LessonTimeDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Расписание звонков не может быть пустым' })
  @ValidateNested({ each: true })
  @Type(() => LessonTimeDto)
  items: LessonTimeDto[];
}
