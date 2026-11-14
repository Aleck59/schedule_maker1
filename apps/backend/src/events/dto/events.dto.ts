import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { DATE_MESSAGE, DATE_REGEX } from '../../common/dto/date-range.dto';

export class GroupIdsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty({ message: 'Выберите хотя бы одну группу' })
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  groupIds: string[];
}

export class DismissEventDto {
  @ApiProperty({ example: 'assessments:2026-12-20' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  key: string;

  @ApiPropertyOptional({ nullable: true, description: 'Скрыть до даты включительно; пусто — навсегда' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  until?: string | null;
}

export class CreateReminderDto {
  @ApiProperty({ example: 'Сдать отчёт о выполнении часов' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите, о чём напомнить' })
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @ApiProperty({ example: '2026-12-25' })
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  date: string;

  @ApiPropertyOptional({ description: 'Повторять каждый год' })
  @IsOptional()
  @IsBoolean()
  yearly?: boolean;
}

export class UpdateReminderDto extends PartialType(CreateReminderDto) {}
