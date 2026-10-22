import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CalendarEventType } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ALL_ROLES, EDITOR_ROLES, Roles, STAFF_ROLES } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { CalendarService } from './calendar.service';
import {
  AutoPlaceAssessmentsDto,
  CreateAssessmentDto,
  CreateCalendarEventDto,
  SetWeekTypeDto,
  UpdateCalendarEventDto,
} from './dto/calendar.dto';

@ApiTags('Календарный учебный график')
@ApiBearerAuth()
@Controller()
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('calendar-events')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Периоды календарного графика: каникулы, практики, сессии, праздники' })
  @ApiQuery({ name: 'programId', required: false })
  @ApiQuery({ name: 'groupId', required: false })
  @ApiQuery({ name: 'teacherId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'eventType', enum: CalendarEventType, required: false })
  list(
    @CurrentUser() user: AuthUser,
    @Query('programId') programId?: string,
    @Query('groupId') groupId?: string,
    @Query('teacherId') teacherId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('eventType') eventType?: CalendarEventType,
  ) {
    return this.calendar.listEvents(user, { programId, groupId, teacherId, from, to, eventType });
  }

  @Get('calendar-events/legend')
  @Roles(...ALL_ROLES)
  legend() {
    return this.calendar.legend();
  }

  @Post('calendar-events')
  @Roles(...EDITOR_ROLES)
  create(@Body() dto: CreateCalendarEventDto, @CurrentUser() user: AuthUser) {
    return this.calendar.createEvent(dto, user);
  }

  @Patch('calendar-events/:id')
  @Roles(...EDITOR_ROLES)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCalendarEventDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.calendar.updateEvent(id, dto, user);
  }

  @Delete('calendar-events/:id')
  @Roles(...EDITOR_ROLES)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.calendar.removeEvent(id, user);
  }

  @Get('programs/:id/calendar-graph')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Календарный учебный график: недели учебных годов с типами' })
  @ApiQuery({ name: 'groupId', required: false })
  graph(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Query('groupId') groupId?: string,
  ) {
    return this.calendar.calendarGraph(id, user, groupId || undefined);
  }

  @Put('programs/:id/calendar-graph/week')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Отметить тип недели в календарном графике' })
  setWeek(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetWeekTypeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.calendar.setWeekType(id, dto, user);
  }

  @Get('semesters/:id/capacity-forecast')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Прогноз: хватает ли учебных недель для выполнения часов' })
  @ApiQuery({ name: 'groupId', required: false })
  capacity(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Query('groupId') groupId?: string,
  ) {
    return this.calendar.capacityForecast(id, user, groupId || undefined);
  }

  @Get('assessment-events')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Контрольные мероприятия (экзамены, зачёты)' })
  @ApiQuery({ name: 'groupId', required: false })
  @ApiQuery({ name: 'semesterId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  listAssessments(
    @CurrentUser() user: AuthUser,
    @Query('groupId') groupId?: string,
    @Query('semesterId') semesterId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.calendar.listAssessments(user, { groupId, semesterId, from, to });
  }

  @Post('assessment-events')
  @Roles(...EDITOR_ROLES)
  createAssessment(@Body() dto: CreateAssessmentDto, @CurrentUser() user: AuthUser) {
    return this.calendar.createAssessment(dto, user);
  }

  @Post('assessment-events/auto-place')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Автоматически распределить экзамены и зачёты' })
  autoPlace(@Body() dto: AutoPlaceAssessmentsDto, @CurrentUser() user: AuthUser) {
    return this.calendar.autoPlaceAssessments(dto, user);
  }

  @Delete('assessment-events/:id')
  @Roles(...EDITOR_ROLES)
  removeAssessment(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.calendar.removeAssessment(id, user);
  }
}
