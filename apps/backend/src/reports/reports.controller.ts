import { Controller, ForbiddenException, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { ExcelService } from '../export/excel.service';
import { PdfService } from '../export/pdf.service';
import { PrismaService } from '../prisma/prisma.service';
import { sendFile } from '../export/send-file';
import { ReportParams, ReportsService } from './reports.service';

const REPORT_ROLES = [UserRole.ADMIN, UserRole.DISPATCHER, UserRole.MANAGER, UserRole.TEACHER];

@ApiTags('Отчёты')
@ApiBearerAuth()
@Roles(...REPORT_ROLES)
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly excel: ExcelService,
    private readonly pdf: PdfService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список доступных отчётов' })
  list(@CurrentUser() user: AuthUser) {
    const all = this.reports.list();
    return user.role === UserRole.TEACHER ? all.filter((r) => TEACHER_REPORTS.includes(r.type)) : all;
  }

  @Get(':type')
  @ApiOperation({ summary: 'Данные отчёта в табличном виде' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'programId', required: false })
  @ApiQuery({ name: 'semesterId', required: false })
  @ApiQuery({ name: 'groupId', required: false })
  @ApiQuery({ name: 'teacherId', required: false })
  @ApiQuery({ name: 'classroomId', required: false })
  build(@Param('type') type: string, @Query() query: ReportParams, @CurrentUser() user: AuthUser) {
    return this.reports.build(type, scoped(type, clean(query), user), user);
  }

  @Get(':type/export')
  @ApiOperation({ summary: 'Выгрузка отчёта в Excel или PDF' })
  @ApiQuery({ name: 'format', enum: ['xlsx', 'pdf'] })
  async export(
    @Param('type') type: string,
    @Query() query: ReportParams & { format?: string },
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const table = await this.reports.build(type, scoped(type, clean(query), user), user);
    if (query.format === 'pdf') {
      const org = await this.prisma.organization.findUnique({ where: { id: user.organizationId } });
      return sendFile(
        res,
        await this.pdf.reportTable(table, org?.name ?? ''),
        `${table.title}.pdf`,
        'application/pdf',
      );
    }
    return sendFile(
      res,
      await this.excel.reportTable(table),
      `${table.title}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }
}

/** Преподавателю доступен только отчёт по собственному расписанию */
const TEACHER_REPORTS = ['teacher-schedule'];

function scoped(type: string, params: ReportParams, user: AuthUser): ReportParams {
  if (user.role !== UserRole.TEACHER) return params;
  if (!TEACHER_REPORTS.includes(type) || !user.teacherId) {
    throw new ForbiddenException('Преподавателю доступен только отчёт по собственному расписанию');
  }
  return { ...params, teacherId: user.teacherId };
}

function clean(query: object): ReportParams {
  const q = query as Record<string, unknown>;
  const result: ReportParams = {};
  for (const key of [
    'from',
    'to',
    'programId',
    'semesterId',
    'groupId',
    'teacherId',
    'classroomId',
    'periodId',
  ] as const) {
    const v = q[key];
    if (typeof v === 'string' && v.trim()) result[key] = v.trim();
  }
  return result;
}
