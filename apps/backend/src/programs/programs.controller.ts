import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ProgramStatus } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EDITOR_ROLES, Roles, STAFF_ROLES } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { CurriculumImportService } from './curriculum-import.service';
import { CurriculumService } from './curriculum.service';
import {
  CreateAcademicYearDto,
  CreateCurriculumItemDto,
  CreateCycleDto,
  CreateProgramDto,
  CreateSemesterDto,
  UpdateProgramDto,
} from './dto/programs.dto';
import { ProgramsService } from './programs.service';

@ApiTags('Учебные планы')
@ApiBearerAuth()
@Controller('programs')
export class ProgramsController {
  constructor(
    private readonly programs: ProgramsService,
    private readonly curriculum: CurriculumService,
    private readonly importer: CurriculumImportService,
  ) {}

  @Get()
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Список образовательных программ (учебных планов)' })
  @ApiQuery({ name: 'status', enum: ProgramStatus, required: false })
  list(@CurrentUser() user: AuthUser, @Query('status') status?: ProgramStatus) {
    return this.programs.list(user, status);
  }

  @Get('import-template')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Шаблон Excel для импорта учебного плана' })
  async template(@Res() res: Response) {
    const buffer = await this.importer.template();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('Шаблон_учебного_плана.xlsx')}`);
    res.send(buffer);
  }

  @Post()
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Создание учебного плана (со структурой учебных годов и семестров)' })
  create(@Body() dto: CreateProgramDto, @CurrentUser() user: AuthUser) {
    return this.programs.create(dto, user);
  }

  @Get(':id')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Карточка учебного плана: семестры, группы, часы' })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.programs.get(id, user);
  }

  @Patch(':id')
  @Roles(...EDITOR_ROLES)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProgramDto, @CurrentUser() user: AuthUser) {
    return this.programs.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(...EDITOR_ROLES)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.programs.remove(id, user);
  }

  @Get(':id/curriculum')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Дерево учебного плана: цикл → ПМ → МДК / практика / дисциплина' })
  @ApiQuery({ name: 'semesterId', required: false })
  tree(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Query('semesterId') semesterId?: string,
  ) {
    return this.curriculum.tree(id, user, semesterId || undefined);
  }

  @Post(':id/curriculum-items')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Добавление дисциплины / ПМ / МДК / практики с часами по семестрам' })
  createItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCurriculumItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.curriculum.createItem(id, dto, user);
  }

  @Post(':id/import')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Импорт учебного плана из Excel (по шаблону)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  importPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    return this.importer.import(id, file.buffer, user);
  }

  @Get(':id/cycles')
  @Roles(...STAFF_ROLES)
  listCycles(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.curriculum.listCycles(id, user);
  }

  @Post(':id/cycles')
  @Roles(...EDITOR_ROLES)
  createCycle(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCycleDto, @CurrentUser() user: AuthUser) {
    return this.curriculum.createCycle(id, dto, user);
  }

  @Get(':id/academic-years')
  @Roles(...STAFF_ROLES)
  listYears(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.programs.listAcademicYears(id, user);
  }

  @Post(':id/academic-years')
  @Roles(...EDITOR_ROLES)
  createYear(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateAcademicYearDto, @CurrentUser() user: AuthUser) {
    return this.programs.createAcademicYear(id, dto, user);
  }

  @Get(':id/semesters')
  @Roles(...STAFF_ROLES)
  listSemesters(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.programs.listSemesters(id, user);
  }

  @Post(':id/semesters')
  @Roles(...EDITOR_ROLES)
  createSemester(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateSemesterDto, @CurrentUser() user: AuthUser) {
    return this.programs.createSemester(id, dto, user);
  }
}
