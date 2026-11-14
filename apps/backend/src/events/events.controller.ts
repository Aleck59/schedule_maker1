import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EDITOR_ROLES, Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { CreateReminderDto, DismissEventDto, GroupIdsDto, UpdateReminderDto } from './dto/events.dto';
import { EventsService } from './events.service';

const VIEW_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.DISPATCHER, UserRole.MANAGER];

@ApiTags('События')
@ApiBearerAuth()
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @Roles(...VIEW_ROLES)
  @ApiQuery({ name: 'days', required: false, description: 'На сколько дней вперёд (7–366, по умолчанию 60)' })
  @ApiOperation({ summary: 'Лента событий: экзамены и зачёты, выпуск групп, периоды графика, праздники, напоминания' })
  list(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    const n = Number(days);
    return this.events.list(user, Number.isFinite(n) && n > 0 ? Math.round(n) : 60);
  }

  @Get('attention')
  @Roles(...VIEW_ROLES)
  @ApiOperation({ summary: 'Сколько событий требует действий (счётчик в меню)' })
  attention(@CurrentUser() user: AuthUser) {
    return this.events.attention(user);
  }

  @Post('groups/archive')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Архивировать группы (неактивны), план — в архив, если все его группы выпустились' })
  archive(@Body() dto: GroupIdsDto, @CurrentUser() user: AuthUser) {
    return this.events.archiveGroups(dto.groupIds, user);
  }

  @Post('groups/delete')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Удалить группы, по которым нет пар в расписании' })
  deleteGroups(@Body() dto: GroupIdsDto, @CurrentUser() user: AuthUser) {
    return this.events.deleteGroups(dto.groupIds, user);
  }

  @Post('groups/sync-semesters')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Обновить курс и семестр в карточках групп по датам учебного плана' })
  sync(@Body() dto: GroupIdsDto, @CurrentUser() user: AuthUser) {
    return this.events.syncSemesters(dto.groupIds, user);
  }

  @Post('dismiss')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Скрыть событие (до даты или навсегда)' })
  dismiss(@Body() dto: DismissEventDto, @CurrentUser() user: AuthUser) {
    return this.events.dismiss(dto, user);
  }

  @Post('restore')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Вернуть скрытое событие' })
  restore(@Body() dto: DismissEventDto, @CurrentUser() user: AuthUser) {
    return this.events.restore(dto.key, user);
  }

  @Post('reminders')
  @Roles(...EDITOR_ROLES)
  createReminder(@Body() dto: CreateReminderDto, @CurrentUser() user: AuthUser) {
    return this.events.createReminder(dto, user);
  }

  @Patch('reminders/:id')
  @Roles(...EDITOR_ROLES)
  updateReminder(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReminderDto, @CurrentUser() user: AuthUser) {
    return this.events.updateReminder(id, dto, user);
  }

  @Post('reminders/:id/done')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Отметить выполненным (ежегодное переносится на следующий год)' })
  completeReminder(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.events.completeReminder(id, user);
  }

  @Delete('reminders/:id')
  @Roles(...EDITOR_ROLES)
  removeReminder(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.events.removeReminder(id, user);
  }
}
