import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

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
