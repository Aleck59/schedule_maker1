import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EducationLevel, WeekParity } from '@prisma/client';
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
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { DATE_MESSAGE, DATE_REGEX } from '../../common/dto/date-range.dto';

export class CreatePermanentScheduleDto {
  @ApiProperty({ example: 'Постоянное расписание, I семестр 2026/27' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите название' })
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: '2026-09-01', description: 'Дата, на которую берутся текущие семестры групп' })
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  date: string;

  @ApiPropertyOptional({
    enum: EducationLevel,
    isArray: true,
    description: 'Уровни образования (пусто — все)',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(EducationLevel, { each: true, message: 'Недопустимый уровень образования' })
  educationLevels?: EducationLevel[];

  @ApiPropertyOptional({ type: [String], description: 'Учебные планы (пусто — все)' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  programIds?: string[];

  @ApiPropertyOptional({ default: true, description: 'Сразу сформировать сетку' })
  @IsOptional()
  @IsBoolean()
  generate?: boolean;
}

export class UpdatePermanentScheduleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Укажите название' })
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class GeneratePermanentDto {
  @ApiPropertyOptional({
    default: true,
    description: 'Ставить пары сверх лимитов группы и дисциплины в день',
  })
  @IsOptional()
  @IsBoolean()
  maximizePlacement?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Избегать окон у групп и преподавателей' })
  @IsOptional()
  @IsBoolean()
  avoidWindows?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Разрешить поздние пары' })
  @IsOptional()
  @IsBoolean()
  allowLateLessons?: boolean;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(300)
  timeLimitSeconds?: number;
}

export class UpdatePermanentLessonDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 7 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  weekday?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  lessonNumber?: number;

  @ApiPropertyOptional({ enum: WeekParity })
  @IsOptional()
  @IsEnum(WeekParity, { message: 'Недопустимая чётность недели' })
  weekParity?: WeekParity;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID('4')
  teacherId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID('4')
  classroomId?: string | null;
}
