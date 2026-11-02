import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsString, MaxLength, Min, Max } from 'class-validator';

export const SLOW_LOAD_OUTCOMES = ['LOADED', 'ERROR', 'LEFT'] as const;
/** Порог, после которого ожидание считается долгим и попадает в журнал, мс */
export const SLOW_LOAD_THRESHOLD_MS = 15_000;

export class CreateSlowLoadDto {
  @ApiProperty({ example: '/workload?tab=teachers' })
  @IsString()
  @MaxLength(500)
  page: string;

  @ApiProperty({ type: [String], example: ['/workload/teachers'] })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  requests: string[];

  @ApiProperty({ example: 18400, description: 'Длительность ожидания, мс (не меньше 15 000)' })
  @IsInt()
  @Min(SLOW_LOAD_THRESHOLD_MS)
  @Max(24 * 3600 * 1000)
  durationMs: number;

  @ApiProperty({ enum: SLOW_LOAD_OUTCOMES })
  @IsIn(SLOW_LOAD_OUTCOMES as unknown as string[])
  outcome: (typeof SLOW_LOAD_OUTCOMES)[number];
}
