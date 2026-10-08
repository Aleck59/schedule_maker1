import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { DATE_MESSAGE, DATE_REGEX } from '../../common/dto/date-range.dto';

export class FixParamsDto {
  @ApiPropertyOptional({ example: '2026-02-12' })
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  date?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  lessonNumber?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  classroomId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  lessonIds?: string[];
}

export class ApplyFixDto {
  @ApiProperty({ enum: ['MOVE', 'CHANGE_ROOM', 'CHANGE_TEACHER', 'DELETE'] })
  @IsIn(['MOVE', 'CHANGE_ROOM', 'CHANGE_TEACHER', 'DELETE'], { message: 'Неизвестное действие' })
  action: 'MOVE' | 'CHANGE_ROOM' | 'CHANGE_TEACHER' | 'DELETE';

  @ApiProperty()
  @IsUUID()
  lessonId: string;

  @ApiPropertyOptional({ description: 'Название варианта (для журнала)' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ type: FixParamsDto })
  @ValidateNested()
  @Type(() => FixParamsDto)
  params: FixParamsDto;
}
