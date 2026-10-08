import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ClassroomType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateClassroomDto {
  @ApiProperty({ example: 'А-301' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите код аудитории' })
  code: string;

  @ApiProperty({ example: 'Компьютерный класс №1' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите наименование аудитории' })
  name: string;

  @ApiPropertyOptional({ example: 'Главный корпус' })
  @IsOptional()
  @IsString()
  building?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(-3)
  @Max(50)
  floor?: number;

  @ApiProperty({ example: 26 })
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity: number;

  @ApiProperty({ enum: ClassroomType })
  @IsEnum(ClassroomType, { message: 'Недопустимый тип аудитории' })
  classroomType: ClassroomType;

  @ApiPropertyOptional({ example: { computers: 26, projector: true } })
  @IsOptional()
  @IsObject()
  equipmentJson?: Record<string, unknown>;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateClassroomDto extends PartialType(CreateClassroomDto) {}
