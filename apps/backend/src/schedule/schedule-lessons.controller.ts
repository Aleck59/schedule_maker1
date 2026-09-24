import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MakeupTaskStatus, UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ALL_ROLES, EDITOR_ROLES, Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import {
  BulkLessonsDto,
  CancelLessonDto,
  CheckLessonDto,
  CopyLessonDto,
  CreateLessonDto,
  LessonQueryDto,
  MarkConductedDto,
  MoveLessonDto,
  ScheduleMakeupDto,
  SubstituteDto,
  UpdateLessonDto,
  UpdateMakeupTaskDto,
} from './dto/schedule.dto';
import { MakeupTasksService } from './makeup-tasks.service';
import { presentLesson, ScheduleLessonsService } from './schedule-lessons.service';

const LESSON_ACTORS: UserRole[] = [UserRole.ADMIN, UserRole.DISPATCHER, UserRole.TEACHER];

@ApiTags('Расписание: занятия')
@ApiBearerAuth()
@Controller()
export class ScheduleLessonsController {
  constructor(
    private readonly lessons: ScheduleLessonsService,
    private readonly makeup: MakeupTasksService,
  ) {}

  @Get('schedule-lessons')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Занятия с фильтрами: период, группа, преподаватель, аудитория, даты' })
  list(@Query() query: LessonQueryDto, @CurrentUser() user: AuthUser) {
    return this.lessons.list(query, user);
  }

  @Get('schedule-lessons/changes')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Изменения расписания: отмены, переносы, замены, дополнительные занятия' })
  @ApiQuery({ name: 'groupId', required: false })
  @ApiQuery({ name: 'teacherId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  changes(
    @CurrentUser() user: AuthUser,
    @Query('groupId') groupId?: string,
    @Query('teacherId') teacherId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.lessons.changes(user, { groupId, teacherId, from, to });
  }

  @Post('schedule-lessons/check')
  @HttpCode(200)
  @Roles(...LESSON_ACTORS)
  @ApiOperation({ summary: 'Проверка конфликтов для размещения занятия (без сохранения)' })
  check(@Body() dto: CheckLessonDto, @CurrentUser() user: AuthUser) {
    return this.lessons.check(dto, user);
  }

  @Post('schedule-lessons/bulk')
  @HttpCode(200)
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Массовое редактирование: изменить, удалить, закрепить, отменить' })
  bulk(@Body() dto: BulkLessonsDto, @CurrentUser() user: AuthUser) {
    return this.lessons.bulk(dto, user);
  }

  @Post('schedule-lessons')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Создание дополнительного занятия (с проверкой конфликтов)' })
  create(@Body() dto: CreateLessonDto, @CurrentUser() user: AuthUser) {
    return this.lessons.create(dto, user);
  }

  @Get('schedule-lessons/:id')
  @Roles(...ALL_ROLES)
  async get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return presentLesson(await this.lessons.get(id, user));
  }

  @Patch('schedule-lessons/:id')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Изменение занятия: аудитория, преподаватель, время, тема' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLessonDto, @CurrentUser() user: AuthUser) {
    return this.lessons.update(id, dto, user);
  }

  @Delete('schedule-lessons/:id')
  @Roles(...EDITOR_ROLES)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.lessons.remove(id, user);
  }

  @Post('schedule-lessons/:id/move')
  @HttpCode(200)
  @Roles(...LESSON_ACTORS)
  @ApiOperation({ summary: 'Перенос занятия (с сохранением связи с исходным)' })
  move(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveLessonDto, @CurrentUser() user: AuthUser) {
    return this.lessons.move(id, dto, user);
  }

  @Post('schedule-lessons/:id/cancel')
  @HttpCode(200)
  @Roles(...LESSON_ACTORS)
  @ApiOperation({ summary: 'Отмена занятия: часы не списываются, создаётся задача «требуется отработка»' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelLessonDto, @CurrentUser() user: AuthUser) {
    return this.lessons.cancel(id, dto, user);
  }

  @Post('schedule-lessons/:id/substitute')
  @HttpCode(200)
  @Roles(...LESSON_ACTORS)
  @ApiOperation({ summary: 'Замена преподавателя' })
  substitute(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SubstituteDto, @CurrentUser() user: AuthUser) {
    return this.lessons.substitute(id, dto, user);
  }

  @Post('schedule-lessons/:id/mark-conducted')
  @HttpCode(200)
  @Roles(...LESSON_ACTORS)
  @ApiOperation({
    summary: 'Отметка о проведении: проведено / частично / заменяющим / отменено / перенесено',
  })
  mark(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkConductedDto, @CurrentUser() user: AuthUser) {
    return this.lessons.markConducted(id, dto, user);
  }

  @Post('schedule-lessons/:id/unmark')
  @HttpCode(200)
  @Roles(...LESSON_ACTORS)
  @ApiOperation({ summary: 'Снять отметку о проведении (исправление)' })
  unmark(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.lessons.unmark(id, user);
  }

  @Post('schedule-lessons/:id/copy')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Копирование занятия в другой слот' })
  copy(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CopyLessonDto, @CurrentUser() user: AuthUser) {
    return this.lessons.copy(id, dto, user);
  }

  @Get('schedule-lessons/:id/free-slots')
  @Roles(...LESSON_ACTORS)
  @ApiOperation({ summary: 'Свободные слоты для переноса или компенсации занятия' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'limit', required: false })
  freeSlots(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.lessons.freeSlots(id, user, { from, to, limit: limit ? Number(limit) : undefined });
  }

  @Get('schedule-lessons/:id/history')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'История занятия: переносы, замены, отметки, журнал изменений' })
  history(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.lessons.history(id, user);
  }

  // ---------------------------------------------------------------- отработки

  @Get('makeup-tasks')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.MANAGER, UserRole.TEACHER)
  @ApiOperation({ summary: 'Задачи «требуется отработка»' })
  @ApiQuery({ name: 'status', enum: MakeupTaskStatus, required: false })
  @ApiQuery({ name: 'groupId', required: false })
  @ApiQuery({ name: 'teacherId', required: false })
  makeupList(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: MakeupTaskStatus,
    @Query('groupId') groupId?: string,
    @Query('teacherId') teacherId?: string,
  ) {
    return this.makeup.list(user, { status, groupId, teacherId });
  }

  @Patch('makeup-tasks/:id')
  @Roles(...EDITOR_ROLES)
  makeupUpdate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMakeupTaskDto, @CurrentUser() user: AuthUser) {
    return this.makeup.update(id, dto, user);
  }

  @Get('makeup-tasks/:id/free-slots')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.TEACHER)
  @ApiOperation({ summary: 'Автоматический поиск свободного слота для компенсации' })
  makeupSlots(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.makeup.freeSlots(id, user, { from, to });
  }

  @Post('makeup-tasks/:id/schedule')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Поставить отработку в расписание' })
  makeupSchedule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ScheduleMakeupDto, @CurrentUser() user: AuthUser) {
    return this.makeup.schedule(id, dto, user);
  }
}
