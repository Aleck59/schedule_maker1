import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AvailabilityRuleKind, WeekParity } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DATE_MESSAGE, DATE_REGEX } from '../../common/dto/date-range.dto';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MESSAGE = 'Время в формате ЧЧ:ММ';

export class AvailabilityRuleDto {
  @ApiProperty({
    enum: AvailabilityRuleKind,
    description:
      'UNAVAILABLE — не может, AVAILABLE_ONLY — может только, PREFERRED — желательно, UNDESIRED — нежелательно, ONLINE — онлайн',
  })
  @IsEnum(AvailabilityRuleKind, { message: 'Укажите вид правила' })
  kind: AvailabilityRuleKind;

  @ApiPropertyOptional({ example: [6], description: 'Дни недели 1–7; пусто — любой день' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  weekdays?: number[];

  @ApiPropertyOptional({ example: [1, 2], description: 'Номера пар; пусто — все пары' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(12)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(12, { each: true })
  lessonNumbers?: number[];

  @ApiPropertyOptional({ example: '13:00', description: 'Начало интервала времени' })
  @IsOptional()
  @Matches(TIME_REGEX, { message: TIME_MESSAGE })
  timeFrom?: string | null;

  @ApiPropertyOptional({ example: '18:00', description: 'Окончание интервала времени' })
  @IsOptional()
  @Matches(TIME_REGEX, { message: TIME_MESSAGE })
  timeTo?: string | null;

  @ApiPropertyOptional({ enum: WeekParity, default: WeekParity.ANY })
  @IsOptional()
  @IsEnum(WeekParity)
  parity?: WeekParity;

  @ApiPropertyOptional({
    example: [-1],
    description: 'Порядковый номер дня недели в месяце: 1–5, −1 — последний («последняя суббота месяца»)',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn([-1, 1, 2, 3, 4, 5], { each: true, message: 'Неделя месяца: 1–5 или −1 (последняя)' })
  monthWeeks?: number[];

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  validFrom?: string | null;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  validTo?: string | null;

  @ApiPropertyOptional({ example: 5, description: 'Сила предпочтения 1–10' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  weight?: number;

  @ApiPropertyOptional({ example: 'Методический день' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class UpdateAvailabilityRuleDto extends PartialType(AvailabilityRuleDto) {}
