import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { HolidayKind } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { DATE_MESSAGE, DATE_REGEX } from '../../common/dto/date-range.dto';

export class CreateHolidayDto {
  @ApiProperty({ example: 'День защитника Отечества' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите название праздника' })
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ enum: HolidayKind })
  @IsOptional()
  @IsEnum(HolidayKind, { message: 'Недопустимый вид праздника' })
  kind?: HolidayKind;

  @ApiPropertyOptional({ nullable: true, description: 'Постоянный праздник: месяц (1–12)' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Постоянный праздник: день месяца' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(31)
  day?: number | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-03-20', description: 'Разовый праздник: дата' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  date?: string | null;

  @ApiPropertyOptional({
    description: 'Переносить выходной, совпавший с праздником, на следующий рабочий день',
  })
  @IsOptional()
  @IsBoolean()
  transferable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class UpdateHolidayDto extends PartialType(CreateHolidayDto) {}

export class CreateTransferDto {
  @ApiProperty({ example: '2027-01-02', description: 'Выходной, который переносится' })
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  fromDate: string;

  @ApiProperty({ example: '2027-11-05', description: 'День, на который переносится выходной' })
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  toDate: string;

  @ApiPropertyOptional({ nullable: true, example: 'Постановление Правительства РФ от 17.09.2026 № 1187' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(300)
  basis?: string | null;
}

export class UpdateHolidaySettingsDto {
  @ApiProperty({ description: 'Перенос выходного, совпавшего с праздником, по ст. 112 ТК РФ' })
  @IsBoolean()
  autoTransfer: boolean;
}
