import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { DATE_MESSAGE, DATE_REGEX } from '../../common/dto/date-range.dto';

export class GenerateScheduleDto {
  @ApiPropertyOptional({
    enum: ['CALENDAR', 'WEEKLY_TEMPLATE'],
    default: 'CALENDAR',
    description: 'CALENDAR — календарное расписание по датам; WEEKLY_TEMPLATE — постоянная неделя с развёрткой',
  })
  @IsOptional()
  @IsIn(['CALENDAR', 'WEEKLY_TEMPLATE'], { message: 'Недопустимый режим генерации' })
  mode?: 'CALENDAR' | 'WEEKLY_TEMPLATE';

  @ApiPropertyOptional({ type: [String], description: 'Группы (по умолчанию — все активные группы учебного плана)' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  groupIds?: string[];

  @ApiPropertyOptional({ example: '2025-09-01' })
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2025-12-20' })
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  dateTo?: string;

  @ApiPropertyOptional({ example: 6, description: 'Число пар в день' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  lessonsPerDay?: number;

  @ApiPropertyOptional({ default: true, description: 'Заменить ранее сгенерированные занятия в интервале' })
  @IsOptional()
  @IsBoolean()
  replaceExisting?: boolean;

  @ApiPropertyOptional({ example: 60 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(3600)
  timeLimitSeconds?: number;

  @ApiPropertyOptional({ enum: ['auto', 'cp-sat', 'heuristic'], default: 'auto' })
  @IsOptional()
  @IsIn(['auto', 'cp-sat', 'heuristic'], { message: 'Недопустимый тип решателя' })
  solver?: 'auto' | 'cp-sat' | 'heuristic';

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

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  avoidWindows?: boolean;

  @ApiPropertyOptional({ default: true, description: 'false — запретить поздние пары' })
  @IsOptional()
  @IsBoolean()
  allowLateLessons?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  respectTeacherPreferences?: boolean;

  @ApiPropertyOptional({ description: 'Переопределение весов мягких ограничений' })
  @IsOptional()
  @IsObject()
  weights?: Record<string, number>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  seed?: number;
}
