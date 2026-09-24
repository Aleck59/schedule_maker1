import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EDITOR_ROLES, Roles, STAFF_ROLES } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { GenerateScheduleDto } from './dto/generation.dto';
import { GenerationQueueService } from './generation-queue.service';
import { GenerationService } from './generation.service';
import { SolverClientService } from './solver-client.service';

@ApiTags('Генерация расписания')
@ApiBearerAuth()
@Controller()
export class GenerationController {
  constructor(
    private readonly generation: GenerationService,
    private readonly solver: SolverClientService,
    private readonly queue: GenerationQueueService,
  ) {}

  @Post('schedule-periods/:id/generate')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({
    summary: 'Запуск генерации расписания (фоновое задание в очереди)',
    description:
      'Возвращает задание генерации. Статусы: QUEUED (ожидание) → GENERATING (генерация) → VALIDATING (проверка) → ' +
      'COMPLETED (готово) / COMPLETED_WITH_CONFLICTS (есть конфликты) / FAILED. Результат применяется отдельно.',
  })
  generate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GenerateScheduleDto, @CurrentUser() user: AuthUser) {
    return this.generation.create(id, dto, user);
  }

  @Get('schedule-periods/:id/generation-jobs')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'История генераций периода' })
  list(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.generation.list(id, user);
  }

  @Get('generation-jobs/:id')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Статус и результат генерации (предпросмотр, нераспределённые занятия, причины)' })
  @ApiQuery({ name: 'result', required: false, type: Boolean })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Query('result') result?: string) {
    return this.generation.get(id, user, result !== 'false');
  }

  @Post('generation-jobs/:id/apply')
  @HttpCode(200)
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Применить результат генерации к расписанию периода' })
  apply(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.generation.apply(id, user);
  }

  @Post('generation-jobs/:id/cancel')
  @HttpCode(200)
  @Roles(...EDITOR_ROLES)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.generation.cancel(id, user);
  }

  @Get('solver/status')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Доступность решателя OR-Tools CP-SAT и режим очереди' })
  async status() {
    return { ...(await this.solver.status()), queue: this.queue.mode };
  }
}
