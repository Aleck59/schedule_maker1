import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ALL_ROLES, Roles, STAFF_ROLES } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { formatDateRu, toDateStr } from '../common/utils/dates';
import { GroupsService } from '../groups/groups.service';
import { HourControlService } from '../hour-control/hour-control.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleLessonsService } from '../schedule/schedule-lessons.service';
import { SettingsService } from '../settings/settings.service';
import { ExcelService } from './excel.service';
import { PdfService } from './pdf.service';
import { sendFile } from './send-file';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('Экспорт')
@ApiBearerAuth()
@Controller()
export class ExportController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lessons: ScheduleLessonsService,
    private readonly settings: SettingsService,
    private readonly pdf: PdfService,
    private readonly excel: ExcelService,
    private readonly hours: HourControlService,
    private readonly groups: GroupsService,
  ) {}

  private async period(id: string, user: AuthUser) {
    const period = await this.prisma.schedulePeriod.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
        status: user.role === UserRole.STUDENT || user.role === UserRole.TEACHER ? 'PUBLISHED' : undefined,
      },
      include: { organization: true },
    });
    if (!period) throw new NotFoundException('Период расписания не найден');
    return period;
  }

  private async gridPdf(
    periodId: string,
    user: AuthUser,
    filter: { groupId?: string; teacherId?: string; classroomId?: string },
    title: string,
    mode: 'group' | 'teacher' | 'classroom',
    from?: string,
    to?: string,
  ) {
    const period = await this.period(periodId, user);
    const settings = await this.settings.getEffective(user.organizationId);
    const range = { from: from ?? toDateStr(period.startDate), to: to ?? toDateStr(period.endDate) };
    const lessons = await this.lessons.list(
      { periodId: filter.teacherId || filter.classroomId ? undefined : periodId, ...filter, ...range },
      user,
    );
    return this.pdf.scheduleGrid({
      title,
      subtitle: `${period.title} · ${formatDateRu(range.from)} — ${formatDateRu(range.to)}`,
      from: range.from,
      to: range.to,
      lessons,
      lessonTimes: settings.lessonTimes,
      workingDays: settings.workingDays,
      mode,
      organization: period.organization.name,
    });
  }

  @Get('schedule-periods/:id/export/group/:groupId/pdf')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'PDF: расписание группы (недельные сетки)' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async groupPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    this.groups.assertGroupAccess(groupId, user);
    const group = await this.prisma.studentGroup.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Группа не найдена');
    const buffer = await this.gridPdf(
      id,
      user,
      { groupId },
      `Расписание группы ${group.code}`,
      'group',
      from,
      to,
    );
    sendFile(res, buffer, `Расписание_${group.code}.pdf`, 'application/pdf');
  }

  @Get('schedule-periods/:id/export/teacher/:teacherId/pdf')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'PDF: расписание преподавателя' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async teacherPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('teacherId', ParseUUIDPipe) teacherId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const teacher = await this.prisma.teacher.findFirst({
      where: { id: teacherId, organizationId: user.organizationId },
    });
    if (!teacher) throw new NotFoundException('Преподаватель не найден');
    const buffer = await this.gridPdf(
      id,
      user,
      { teacherId },
      `Расписание преподавателя ${teacher.fullName}`,
      'teacher',
      from,
      to,
    );
    sendFile(res, buffer, `Расписание_${teacher.fullName}.pdf`, 'application/pdf');
  }

  @Get('schedule-periods/:id/export/classroom/:classroomId/pdf')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'PDF: занятость аудитории' })
  async classroomPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('classroomId', ParseUUIDPipe) classroomId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const room = await this.prisma.classroom.findFirst({
      where: { id: classroomId, organizationId: user.organizationId },
    });
    if (!room) throw new NotFoundException('Аудитория не найдена');
    const buffer = await this.gridPdf(
      id,
      user,
      { classroomId },
      `Расписание аудитории ${room.code}`,
      'classroom',
      from,
      to,
    );
    sendFile(res, buffer, `Аудитория_${room.code}.pdf`, 'application/pdf');
  }

  @Get('schedule-periods/:id/export/excel')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Excel: расписание периода (список занятий и сетки по группам)' })
  @ApiQuery({ name: 'groupId', required: false })
  async periodExcel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('groupId') groupId?: string,
  ) {
    const period = await this.period(id, user);
    const settings = await this.settings.getEffective(user.organizationId);
    const lessons = await this.lessons.list({ periodId: id, groupId: groupId || undefined }, user);
    const buffer = await this.excel.schedule({
      title: period.title,
      lessons,
      lessonTimes: settings.lessonTimes,
      workingDays: settings.workingDays,
      from: toDateStr(period.startDate),
      to: toDateStr(period.endDate),
    });
    sendFile(res, buffer, `Расписание_${period.title}.xlsx`, XLSX);
  }

  @Get('programs/:id/export/hour-control/excel')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Excel: выполнение часов по учебному плану' })
  @ApiQuery({ name: 'semesterId', required: false })
  async hourControlExcel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('semesterId') semesterId?: string,
  ) {
    const program = await this.prisma.educationalProgram.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!program) throw new NotFoundException('Учебный план не найден');
    const { rows } = await this.hours.rows({
      organizationId: user.organizationId,
      programId: id,
      semesterIds: semesterId ? [semesterId] : undefined,
    });
    const buffer = await this.excel.hourControl(`Выполнение часов: ${program.title}`, rows);
    sendFile(res, buffer, `Выполнение_часов_${program.title}.xlsx`, XLSX);
  }
}
