import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

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

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTeacherDto extends PartialType(CreateTeacherDto) {}
