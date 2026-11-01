import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EDITOR_ROLES, Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { PdfService } from '../export/pdf.service';
import { sendFile } from '../export/send-file';
import { ExportReportFormDto, RenderReportFormDto, SaveReportFormDto } from './dto/report-form.dto';
import { formToExcel, formToPdfDefinition } from './form-writers';
import { ReportFormsService } from './report-forms.service';

/** Формы отчётов доступны составителям и руководству (преподавателю — только свой отчёт на странице «Отчёты») */
const VIEW_ROLES = [UserRole.ADMIN, UserRole.DISPATCHER, UserRole.MANAGER];

@ApiTags('Формы отчётов')
@ApiBearerAuth()
@Controller('report-forms')
export class ReportFormsController {
  constructor(
    private readonly forms: ReportFormsService,
    private readonly pdf: PdfService,
  ) {}

  @Get()
  @Roles(...VIEW_ROLES)
  @ApiOperation({ summary: 'Сохранённые формы отчётов' })
  list(@CurrentUser() user: AuthUser) {
    return this.forms.list(user);
  }

  @Get('sources')
  @Roles(...VIEW_ROLES)
  @ApiOperation({ summary: 'Источники данных и поля для подстановки' })
  sources() {
    return this.forms.sources();
  }

  @Post('render')
  @Roles(...VIEW_ROLES)
  @ApiOperation({ summary: 'Заполнить форму данными (предпросмотр, в т.ч. несохранённой формы)' })
  async render(@Body() dto: RenderReportFormDto, @CurrentUser() user: AuthUser) {
    return (await this.forms.render(dto.content, dto.params, user)).sheet;
  }

  @Post('export')
  @Roles(...VIEW_ROLES)
  @ApiOperation({ summary: 'Выгрузить заполненную форму в Excel или PDF' })
  async export(@Body() dto: ExportReportFormDto, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const { sheet, title } = await this.forms.render(dto.content, dto.params, user);
    const name = dto.name?.trim() || title;
    if (dto.format === 'pdf') {
      return sendFile(
        res,
        await this.pdf.render(formToPdfDefinition(sheet, name)),
        `${name}.pdf`,
        'application/pdf',
      );
    }
    return sendFile(
      res,
      await formToExcel(sheet, name),
      `${name}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }

  @Get(':id')
  @Roles(...VIEW_ROLES)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.forms.get(id, user);
  }

  @Post()
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Создать форму отчёта' })
  create(@Body() dto: SaveReportFormDto, @CurrentUser() user: AuthUser) {
    return this.forms.create(dto, user);
  }

  @Put(':id')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Сохранить форму отчёта' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveReportFormDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.forms.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(...EDITOR_ROLES)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.forms.remove(id, user);
  }
}
