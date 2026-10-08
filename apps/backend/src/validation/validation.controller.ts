import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Severity } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EDITOR_ROLES, Roles, STAFF_ROLES } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { ScheduleValidatorService } from './schedule-validator.service';

@ApiTags('Проверка расписания')
@ApiBearerAuth()
@Controller('schedule-periods')
export class ValidationController {
  constructor(private readonly validator: ScheduleValidatorService) {}

  @Post(':id/validate')
  @HttpCode(200)
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Полная проверка расписания периода (результаты сохраняются)' })
  validate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.validator.validatePeriod(id, user.organizationId, true);
  }

  @Get(':id/conflicts')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Актуальные конфликты расписания (ошибки, блокирующие публикацию)' })
  async conflicts(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const summary = await this.validator.validatePeriod(id, user.organizationId, false);
    return {
      errors: summary.errors,
      canPublish: summary.canPublish,
      items: summary.items.filter((i) => i.severity === Severity.ERROR),
    };
  }

  @Get(':id/validation-results')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Сохранённые результаты последней проверки' })
  @ApiQuery({ name: 'severity', enum: Severity, required: false })
  results(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Query('severity') severity?: Severity,
  ) {
    return this.validator.storedResults(id, user.organizationId, severity);
  }
}
