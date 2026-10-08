import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class CreateGroupDto {
  @ApiProperty()
  @IsUUID('4', { message: 'Укажите учебный план' })
  educationalProgramId: string;

  @ApiProperty({ example: 'ИСП-24-1' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите шифр группы' })
  code: string;

  @ApiPropertyOptional({ example: 'Информационные системы и программирование, набор 2024, группа 1' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: 2024, description: 'По умолчанию — год набора учебного плана' })
  @IsOptional()
  @IsInt()
  admissionYear?: number;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  @Max(6)
  courseNumber: number;

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  @Max(12)
  currentSemesterNumber: number;

  @ApiProperty({ example: 25 })
  @IsInt()
  @Min(1)
  @Max(200)
  studentCount: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  subgroupCount?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateGroupDto extends PartialType(CreateGroupDto) {}

export class SubgroupItemDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(6)
  number: number;

  @ApiPropertyOptional({ example: 'Подгруппа 1' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 13 })
  @IsOptional()
  @IsInt()
  @Min(0)
  studentCount?: number;

  @ApiPropertyOptional({ type: [String], description: 'Студенты подгруппы' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  studentIds?: string[];
}

export class ConfigureSubgroupsDto {
  @ApiProperty({ type: [SubgroupItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Укажите хотя бы одну подгруппу' })
  @ValidateNested({ each: true })
  @Type(() => SubgroupItemDto)
  subgroups: SubgroupItemDto[];
}

export class StudentItemDto {
  @ApiProperty({ example: 'Иванов Иван Иванович' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите ФИО студента' })
  fullName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recordBookNumber?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  subgroupNumber?: number;
}

export class AddStudentsDto {
  @ApiProperty({ type: [StudentItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Список студентов пуст' })
  @ValidateNested({ each: true })
  @Type(() => StudentItemDto)
  students: StudentItemDto[];
}

export class UpdateStudentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recordBookNumber?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Номер подгруппы (null — без подгруппы)' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  subgroupNumber?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
