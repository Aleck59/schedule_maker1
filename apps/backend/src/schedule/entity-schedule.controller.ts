import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { LessonStatus } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ALL_ROLES, Roles, STAFF_ROLES } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { addDaysStr, eachDay, isoWeekday, todayInTimezone, weekStart } from '../common/utils/dates';
import { GroupsService } from '../groups/groups.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ScheduleLessonsService } from './schedule-lessons.service';

@ApiTags('Расписание: просмотр')
@ApiBearerAuth()
@Controller()
export class EntityScheduleController {
  constructor(
    private readonly lessons: ScheduleLessonsService,
    private readonly groups: GroupsService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async range(user: AuthUser, from?: string, to?: string) {
    const settings = await this.settings.getEffective(user.organizationId);
    const start = from ?? weekStart(todayInTimezone(settings.timezone));
    return { from: start, to: to ?? addDaysStr(start, 6) };
  }

  @Get('groups/:id/schedule')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Расписание группы' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'periodId', required: false })
  async group(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('periodId') periodId?: string,
  ) {
    this.groups.assertGroupAccess(id, user);
    const r = await this.range(user, from, to);
    return this.lessons.list({ groupId: id, periodId, ...r }, user);
  }

  @Get('teachers/:id/schedule')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Личное расписание преподавателя' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async teacher(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const r = await this.range(user, from, to);
    return this.lessons.list({ teacherId: id, ...r }, user);
  }

  @Get('classrooms/:id/schedule')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Занятость аудитории по дням и парам' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async classroom(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const room = await this.prisma.classroom.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!room) throw new NotFoundException('Аудитория не найдена');
    const settings = await this.settings.getEffective(user.organizationId);
    const r = await this.range(user, from, to);
    const lessons = await this.lessons.list({ classroomId: id, ...r }, user);
    const active = lessons.filter(
      (l) => l.status !== LessonStatus.CANCELLED && l.status !== LessonStatus.MOVED,
    );
    const days = eachDay(r.from, r.to).filter((d) => settings.workingDays.includes(isoWeekday(d)));
    const slotsTotal = days.length * settings.lessonsPerDay;
    const used = new Set(active.map((l) => `${l.date}#${l.lessonNumber}`)).size;
    const grid: Record<string, number> = {};
    for (const l of active) {
      const key = `${isoWeekday(l.date)}-${l.lessonNumber}`;
      grid[key] = (grid[key] ?? 0) + 1;
    }
    return {
      classroom: room,
      range: r,
      lessons,
      occupancy: {
        slotsTotal,
        slotsUsed: used,
        percent: slotsTotal ? Math.round((used / slotsTotal) * 1000) / 10 : 0,
        grid,
      },
    };
  }
}
