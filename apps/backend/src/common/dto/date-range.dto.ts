import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const DATE_MESSAGE = 'Дата должна быть в формате ГГГГ-ММ-ДД';

export class DateRangeQueryDto {
  @ApiPropertyOptional({ example: '2025-09-01', description: 'Начало периода (включительно)' })
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  from?: string;

  @ApiPropertyOptional({ example: '2025-09-07', description: 'Окончание периода (включительно)' })
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  to?: string;
}
