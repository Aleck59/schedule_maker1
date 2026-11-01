import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SaveReportFormDto {
  @ApiProperty({ example: 'Ведомость нагрузки для бухгалтерии' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите название формы' })
  @MaxLength(160)
  name: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiProperty({ description: 'Лист формы: ячейки, оформление, объединения, повторяющаяся строка' })
  @IsObject({ message: 'Содержимое формы задано неверно' })
  content: Record<string, unknown>;
}

export class RenderReportFormDto {
  @ApiProperty({ description: 'Лист формы (можно несохранённый)' })
  @IsObject({ message: 'Содержимое формы задано неверно' })
  content: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Параметры источника данных: from, to, groupId, …' })
  @IsOptional()
  @IsObject()
  params?: Record<string, string>;
}

export class ExportReportFormDto extends RenderReportFormDto {
  @ApiPropertyOptional({ description: 'Имя файла' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ enum: ['xlsx', 'pdf'] })
  @IsOptional()
  @IsIn(['xlsx', 'pdf'], { message: 'Формат: xlsx или pdf' })
  format?: 'xlsx' | 'pdf';
}

export class ScheduleBlankDto {
  @ApiProperty({ type: [String], description: 'Группы — столбцы бланка, по порядку' })
  @IsArray()
  @ArrayMinSize(1, { message: 'Выберите хотя бы одну группу' })
  @ArrayMaxSize(12, { message: 'Не больше 12 групп на одном бланке' })
  @IsUUID('all', { each: true })
  groupIds: string[];

  @ApiPropertyOptional({ enum: ['rooms', 'types', 'header-room'] })
  @IsOptional()
  @IsIn(['rooms', 'types', 'header-room'])
  layout?: 'rooms' | 'types' | 'header-room';

  @ApiPropertyOptional({ description: 'Строк (пар) на день' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  pairs?: number;

  @ApiPropertyOptional({ description: 'Грифов над таблицей: 1–3' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  approvals?: number;
}
