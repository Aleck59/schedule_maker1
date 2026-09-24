import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EDITOR_ROLES, Roles, STAFF_ROLES } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { AssignmentsService } from './assignments.service';
import { CreateAssignmentDto, GenerateAssignmentsDto, UpdateAssignmentDto } from './dto/assignments.dto';

@ApiTags('Нагрузка преподавателей')
@ApiBearerAuth()
@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get()
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Назначения: группа × дисциплина × преподаватель' })
  @ApiQuery({ name: 'groupId', required: false })
  @ApiQuery({ name: 'teacherId', required: false })
  @ApiQuery({ name: 'semesterId', required: false })
  @ApiQuery({ name: 'programId', required: false })
  @ApiQuery({ name: 'semesterItemId', required: false })
  list(
    @CurrentUser() user: AuthUser,
    @Query('groupId') groupId?: string,
    @Query('teacherId') teacherId?: string,
    @Query('semesterId') semesterId?: string,
    @Query('programId') programId?: string,
    @Query('semesterItemId') semesterItemId?: string,
  ) {
    return this.assignments.list(user, { groupId, teacherId, semesterId, programId, semesterItemId });
  }

  @Post()
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Назначение преподавателя на дисциплину группы (подгруппы)' })
  create(@Body() dto: CreateAssignmentDto, @CurrentUser() user: AuthUser) {
    return this.assignments.create(dto, user);
  }

  @Post('generate')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Сформировать нагрузку группы на семестр по учебному плану' })
  generate(@Body() dto: GenerateAssignmentsDto, @CurrentUser() user: AuthUser) {
    return this.assignments.generate(dto, user);
  }

  @Get(':id')
  @Roles(...STAFF_ROLES)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.assignments.get(id, user);
  }

  @Patch(':id')
  @Roles(...EDITOR_ROLES)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssignmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assignments.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(...EDITOR_ROLES)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.assignments.remove(id, user);
  }
}
