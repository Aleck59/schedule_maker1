import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { EducationLevel } from '@prisma/client';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { DATE_MESSAGE, DATE_REGEX } from '../../common/dto/date-range.dto';

export class CreateSpecialtyDto {
  @ApiProperty({ example: '09.02.07', description: 'Код специальности СПО или направления подготовки ВО' })
  @Matches(/^\d{2}\.\d{2}\.\d{2}$/, { message: 'Код специальности должен быть в формате 00.00.00' })
  code: string;

  @ApiPropertyOptional({
    enum: EducationLevel,
    description:
      'Уровень образования; по умолчанию определяется по коду (00.02.00 — СПО, 00.03.00 — бакалавриат…)',
  })
  @IsOptional()
  @IsEnum(EducationLevel, { message: 'Некорректный уровень образования' })
  educationLevel?: EducationLevel;

  @ApiProperty({ example: 'Информационные системы и программирование' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите наименование специальности' })
  name: string;

  @ApiProperty({ example: 'Программист' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите квалификацию' })
  qualification: string;

  @ApiPropertyOptional({ example: '1547' })
  @IsOptional()
  @IsString()
  fgosNumber?: string;

  @ApiPropertyOptional({ example: '2016-12-09' })
  @IsOptional()
  @Matches(DATE_REGEX, { message: DATE_MESSAGE })
  fgosDate?: string;

  @ApiProperty({ example: 46, description: 'Срок обучения в месяцах (3 г. 10 мес. = 46)' })
  @IsInt()
  @Min(1)
  @Max(120)
  durationMonths: number;
}

export class UpdateSpecialtyDto extends PartialType(CreateSpecialtyDto) {}
