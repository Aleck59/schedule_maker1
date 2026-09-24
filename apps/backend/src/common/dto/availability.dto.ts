import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class AvailabilityItemDto {
  @ApiProperty({ example: 1, description: '1 — понедельник ... 7 — воскресенье' })
  @IsInt()
  @Min(1)
  @Max(7)
  weekday: number;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(12)
  lessonNumber: number;

  @ApiProperty({ example: false })
  @IsBoolean()
  isAvailable: boolean;

  @ApiPropertyOptional({ example: -5, description: 'Предпочтение: > 0 желательно, < 0 нежелательно' })
  @IsOptional()
  @IsInt()
  @Min(-10)
  @Max(10)
  preferenceWeight?: number;

  @ApiPropertyOptional({ example: 'Методический день' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ReplaceAvailabilityDto {
  @ApiProperty({
    type: [AvailabilityItemDto],
    description: 'Полный список исключений: не указанные слоты считаются доступными',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilityItemDto)
  items: AvailabilityItemDto[];
}
