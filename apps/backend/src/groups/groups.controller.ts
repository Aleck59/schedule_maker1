import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ALL_ROLES, EDITOR_ROLES, Roles, STAFF_ROLES } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { AddStudentsDto, ConfigureSubgroupsDto, CreateGroupDto, UpdateGroupDto, UpdateStudentDto } from './dto/groups.dto';
import { GroupsService } from './groups.service';

@ApiTags('Учебные группы')
@ApiBearerAuth()
@Controller()
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get('groups')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Список учебных групп' })
  @ApiQuery({ name: 'programId', required: false })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({ name: 'search', required: false })
  list(
    @CurrentUser() user: AuthUser,
    @Query('programId') programId?: string,
    @Query('isActive') isActive?: string,
    @Query('search') search?: string,
  ) {
    return this.groups.list(user, {
      programId,
      isActive: isActive === undefined || isActive === '' ? undefined : isActive === 'true',
      search,
    });
  }

  @Post('groups')
  @Roles(...EDITOR_ROLES)
  create(@Body() dto: CreateGroupDto, @CurrentUser() user: AuthUser) {
    return this.groups.create(dto, user);
  }

  @Get('groups/:id')
  @Roles(...ALL_ROLES)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.groups.get(id, user);
  }

  @Patch('groups/:id')
  @Roles(...EDITOR_ROLES)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGroupDto, @CurrentUser() user: AuthUser) {
    return this.groups.update(id, dto, user);
  }

  @Delete('groups/:id')
  @Roles(...EDITOR_ROLES)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.groups.remove(id, user);
  }

  @Get('groups/:id/subgroups')
  @Roles(...STAFF_ROLES)
  listSubgroups(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.groups.listSubgroups(id, user);
  }

  @Post('groups/:id/subgroups')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Настройка подгрупп: количество, названия, состав студентов' })
  configureSubgroups(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfigureSubgroupsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.groups.configureSubgroups(id, dto, user);
  }

  @Get('groups/:id/students')
  @Roles(...STAFF_ROLES)
  listStudents(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.groups.listStudents(id, user);
  }

  @Post('groups/:id/students')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Добавление студентов (списком)' })
  addStudents(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddStudentsDto, @CurrentUser() user: AuthUser) {
    return this.groups.addStudents(id, dto, user);
  }

  @Patch('students/:id')
  @Roles(...EDITOR_ROLES)
  updateStudent(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStudentDto, @CurrentUser() user: AuthUser) {
    return this.groups.updateStudent(id, dto, user);
  }

  @Delete('students/:id')
  @Roles(...EDITOR_ROLES)
  removeStudent(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.groups.removeStudent(id, user);
  }
}
