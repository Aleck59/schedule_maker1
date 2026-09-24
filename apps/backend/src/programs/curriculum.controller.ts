import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EDITOR_ROLES, Roles, STAFF_ROLES } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { CurriculumService } from './curriculum.service';
import {
  SemesterHoursDto,
  UpdateAcademicYearDto,
  UpdateCurriculumItemDto,
  UpdateCycleDto,
  UpdateSemesterDto,
  UpdateSemesterItemDto,
} from './dto/programs.dto';
import { ProgramsService } from './programs.service';

@ApiTags('Учебные планы')
@ApiBearerAuth()
@Controller()
export class CurriculumController {
  constructor(
    private readonly curriculum: CurriculumService,
    private readonly programs: ProgramsService,
  ) {}

  @Get('curriculum-items/:id')
  @Roles(...STAFF_ROLES)
  getItem(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.curriculum.getItem(id, user);
  }

  @Patch('curriculum-items/:id')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Изменение элемента учебного плана и часов по семестрам' })
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCurriculumItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.curriculum.updateItem(id, dto, user);
  }

  @Delete('curriculum-items/:id')
  @Roles(...EDITOR_ROLES)
  removeItem(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.curriculum.removeItem(id, user);
  }

  @Post('curriculum-items/:id/semesters')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Добавление/изменение часов элемента плана в семестре' })
  upsertSemester(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SemesterHoursDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.curriculum.upsertItemSemester(id, dto, user);
  }

  @Patch('semester-items/:id')
  @Roles(...EDITOR_ROLES)
  updateSemesterItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSemesterItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.curriculum.updateSemesterItem(id, dto, user);
  }

  @Delete('semester-items/:id')
  @Roles(...EDITOR_ROLES)
  removeSemesterItem(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.curriculum.removeSemesterItem(id, user);
  }

  @Patch('cycles/:id')
  @Roles(...EDITOR_ROLES)
  updateCycle(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCycleDto, @CurrentUser() user: AuthUser) {
    return this.curriculum.updateCycle(id, dto, user);
  }

  @Delete('cycles/:id')
  @Roles(...EDITOR_ROLES)
  removeCycle(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.curriculum.removeCycle(id, user);
  }

  @Patch('academic-years/:id')
  @Roles(...EDITOR_ROLES)
  updateYear(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAcademicYearDto, @CurrentUser() user: AuthUser) {
    return this.programs.updateAcademicYear(id, dto, user);
  }

  @Delete('academic-years/:id')
  @Roles(...EDITOR_ROLES)
  removeYear(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.programs.removeAcademicYear(id, user);
  }

  @Get('semesters')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Все семестры действующих учебных планов' })
  allSemesters(@CurrentUser() user: AuthUser) {
    return this.programs.listAllSemesters(user);
  }

  @Get('semesters/:id')
  @Roles(...STAFF_ROLES)
  getSemester(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.programs.getSemester(id, user);
  }

  @Get('semesters/:id/items')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Дисциплины семестра с часами и плановыми парами' })
  semesterItems(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.curriculum.listSemesterItems(id, user);
  }

  @Patch('semesters/:id')
  @Roles(...EDITOR_ROLES)
  updateSemester(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSemesterDto, @CurrentUser() user: AuthUser) {
    return this.programs.updateSemester(id, dto, user);
  }

  @Delete('semesters/:id')
  @Roles(...EDITOR_ROLES)
  removeSemester(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.programs.removeSemester(id, user);
  }
}
