import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SchedulePeriodStatus } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ALL_ROLES, EDITOR_ROLES, Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { ClearPeriodDto, CreatePeriodDto, UpdatePeriodDto } from './dto/schedule.dto';
import { SchedulePeriodsService } from './schedule-periods.service';

@ApiTags('Расписание: периоды')
@ApiBearerAuth()
@Controller('schedule-periods')
export class SchedulePeriodsController {
  constructor(private readonly periods: SchedulePeriodsService) {}

  @Get()
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Периоды расписания (семестры)' })
  @ApiQuery({ name: 'semesterId', required: false })
  @ApiQuery({ name: 'programId', required: false })
  @ApiQuery({ name: 'status', enum: SchedulePeriodStatus, required: false })
  list(
    @CurrentUser() user: AuthUser,
    @Query('semesterId') semesterId?: string,
    @Query('programId') programId?: string,
    @Query('status') status?: SchedulePeriodStatus,
  ) {
    return this.periods.list(user, { semesterId, programId, status });
  }

  @Post()
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Создание периода расписания для семестра' })
  create(@Body() dto: CreatePeriodDto, @CurrentUser() user: AuthUser) {
    return this.periods.create(dto, user);
  }

  @Get(':id')
  @Roles(...ALL_ROLES)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.periods.get(id, user);
  }

  @Patch(':id')
  @Roles(...EDITOR_ROLES)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePeriodDto, @CurrentUser() user: AuthUser) {
    return this.periods.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(...EDITOR_ROLES)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.periods.remove(id, user);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Публикация расписания (блокируется при наличии ошибок проверки)' })
  publish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.periods.publish(id, user);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @Roles(...EDITOR_ROLES)
  unpublish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.periods.unpublish(id, user);
  }

  @Post(':id/clear')
  @HttpCode(200)
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Удалить запланированные (непроведённые, незакреплённые) занятия периода' })
  clear(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ClearPeriodDto, @CurrentUser() user: AuthUser) {
    return this.periods.clear(id, dto, user);
  }
}
