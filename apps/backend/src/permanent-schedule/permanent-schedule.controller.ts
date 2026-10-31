import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EDITOR_ROLES, Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { ScheduleFormService } from '../export/schedule-form.service';
import { sendFile } from '../export/send-file';
import {
  CreatePermanentScheduleDto,
  GeneratePermanentDto,
  UpdatePermanentLessonDto,
  UpdatePermanentScheduleDto,
} from './dto/permanent-schedule.dto';
import { PermanentScheduleService } from './permanent-schedule.service';

/** Руководство и диспетчеры: просмотр; правка — только диспетчеры и администратор */
const VIEW_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.DISPATCHER, UserRole.MANAGER];
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('Постоянное расписание')
@ApiBearerAuth()
@Controller('permanent-schedules')
export class PermanentScheduleController {
  constructor(
    private readonly service: PermanentScheduleService,
    private readonly form: ScheduleFormService,
  ) {}

  @Get()
  @Roles(...VIEW_ROLES)
  @ApiOperation({ summary: 'Версии постоянного расписания' })
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user);
  }

  @Post()
  @Roles(...EDITOR_ROLES)
  @ApiOperation({
    summary: 'Создать постоянное расписание',
    description:
      'Типовая неделя для руководства по нагрузке текущих семестров групп на дату. Недоступность, пожелания ' +
      'и лимиты преподавателей не учитываются; рабочее расписание по датам не меняется.',
  })
  create(@Body() dto: CreatePermanentScheduleDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Get(':id')
  @Roles(...VIEW_ROLES)
  @ApiOperation({ summary: 'Постоянное расписание с парами' })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.get(id, user);
  }

  @Patch(':id')
  @Roles(...EDITOR_ROLES)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePermanentScheduleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(...EDITOR_ROLES)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }

  @Post(':id/generate')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Сформировать сетку заново (ручные правки заменяются)' })
  generate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GeneratePermanentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.generate(id, dto, user);
  }

  @Post(':id/approve')
  @Roles(...EDITOR_ROLES)
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, true, user);
  }

  @Post(':id/unapprove')
  @Roles(...EDITOR_ROLES)
  unapprove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, false, user);
  }

  @Patch(':id/lessons/:lessonId')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Перенести пару или сменить преподавателя/аудиторию (проверка накладок)' })
  updateLesson(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: UpdatePermanentLessonDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateLesson(id, lessonId, dto, user);
  }

  @Delete(':id/lessons/:lessonId')
  @Roles(...EDITOR_ROLES)
  removeLesson(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.removeLesson(id, lessonId, user);
  }

  @Get(':id/form/sheets')
  @Roles(...VIEW_ROLES)
  @ApiOperation({ summary: 'Печатная форма: специальности постоянного расписания' })
  sheets(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.form.permanentSheets(user, id);
  }

  @Get(':id/form/export')
  @Roles(...VIEW_ROLES)
  @ApiOperation({ summary: 'Печатная форма постоянного расписания (PDF или Excel)' })
  @ApiQuery({ name: 'format', enum: ['pdf', 'xlsx'], required: false })
  @ApiQuery({ name: 'keys', required: false, description: 'Специальности через запятую' })
  @ApiQuery({ name: 'lessonTypes', required: false })
  async export(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('format') format?: string,
    @Query('keys') keys?: string,
    @Query('lessonTypes') lessonTypes?: string,
  ) {
    const { title, sheets } = await this.form.buildPermanent(user, id, {
      keys: keys ? keys.split(',').filter(Boolean) : undefined,
      lessonTypes: lessonTypes === 'true',
    });
    const name = title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Постоянное расписание';
    if (format === 'xlsx') sendFile(res, await this.form.excelBuffer(sheets), `${name}.xlsx`, XLSX);
    else sendFile(res, await this.form.pdfBuffer(sheets), `${name}.pdf`, 'application/pdf');
  }
}
