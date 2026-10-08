import { Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ALL_ROLES, Roles, STAFF_ROLES } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { GroupsService } from '../groups/groups.service';
import { HourControlService } from './hour-control.service';

type AggregateBy = 'group' | 'discipline' | 'teacher' | 'semester' | 'program' | 'college';

@ApiTags('Контроль часов')
@ApiBearerAuth()
@Controller()
export class HourControlController {
  constructor(
    private readonly hours: HourControlService,
    private readonly groups: GroupsService,
  ) {}

  @Get('hour-control')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Выполнение часов по всему колледжу (с фильтрами)' })
  @ApiQuery({ name: 'programId', required: false })
  @ApiQuery({ name: 'semesterId', required: false })
  @ApiQuery({ name: 'groupId', required: false })
  @ApiQuery({ name: 'teacherId', required: false })
  @ApiQuery({ name: 'semesterItemId', required: false })
  list(
    @CurrentUser() user: AuthUser,
    @Query('programId') programId?: string,
    @Query('semesterId') semesterId?: string,
    @Query('groupId') groupId?: string,
    @Query('teacherId') teacherId?: string,
    @Query('semesterItemId') semesterItemId?: string,
  ) {
    return this.hours.rows({
      organizationId: user.organizationId,
      programId,
      semesterIds: semesterId ? [semesterId] : undefined,
      groupIds: groupId ? [groupId] : undefined,
      // Преподаватель видит только свои дисциплины
      teacherId: user.role === UserRole.TEACHER ? this.ownTeacherId(user) : teacherId,
      semesterItemId,
    });
  }

  @Get('hour-control/summary')
  @Roles(...STAFF_ROLES)
  @ApiOperation({
    summary:
      'Сводка выполнения часов по разрезам: группа, дисциплина, преподаватель, семестр, программа, колледж',
  })
  @ApiQuery({ name: 'by', enum: ['group', 'discipline', 'teacher', 'semester', 'program', 'college'] })
  @ApiQuery({ name: 'programId', required: false })
  @ApiQuery({ name: 'semesterId', required: false })
  summary(
    @CurrentUser() user: AuthUser,
    @Query('by') by: AggregateBy = 'group',
    @Query('programId') programId?: string,
    @Query('semesterId') semesterId?: string,
  ) {
    return this.hours.aggregate(
      {
        organizationId: user.organizationId,
        programId,
        semesterIds: semesterId ? [semesterId] : undefined,
        teacherId: user.role === UserRole.TEACHER ? this.ownTeacherId(user) : undefined,
      },
      by,
    );
  }

  @Get('programs/:id/hour-control')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Выполнение часов по образовательной программе' })
  @ApiQuery({ name: 'semesterId', required: false })
  program(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Query('semesterId') semesterId?: string,
  ) {
    return this.hours.rows({
      organizationId: user.organizationId,
      programId: id,
      semesterIds: semesterId ? [semesterId] : undefined,
      teacherId: user.role === UserRole.TEACHER ? this.ownTeacherId(user) : undefined,
    });
  }

  @Get('groups/:id/hour-control')
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Выполнение часов группы: план / в расписании / проведено / остаток' })
  @ApiQuery({ name: 'semesterId', required: false })
  group(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Query('semesterId') semesterId?: string,
  ) {
    this.groups.assertGroupAccess(id, user);
    return this.hours.rows({
      organizationId: user.organizationId,
      groupIds: [id],
      semesterIds: semesterId ? [semesterId] : undefined,
      includeInactiveGroups: true,
    });
  }

  @Get('teachers/:id/workload')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Нагрузка преподавателя: плановая, в расписании, фактическая' })
  @ApiQuery({ name: 'semesterId', required: false })
  workload(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Query('semesterId') semesterId?: string,
  ) {
    this.assertTeacher(id, user);
    return this.hours.teacherWorkload(user.organizationId, id, semesterId || undefined);
  }

  @Get('teachers/:id/workload-control')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Контроль нагрузки преподавателя по группам и дисциплинам' })
  @ApiQuery({ name: 'semesterId', required: false })
  workloadControl(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Query('semesterId') semesterId?: string,
  ) {
    this.assertTeacher(id, user);
    return this.hours.teacherWorkload(user.organizationId, id, semesterId || undefined);
  }

  @Get('workload/teachers')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Сводная нагрузка всех преподавателей' })
  @ApiQuery({ name: 'semesterId', required: false })
  allTeachers(@CurrentUser() user: AuthUser, @Query('semesterId') semesterId?: string) {
    return this.hours.allTeachersWorkload(user.organizationId, semesterId || undefined);
  }

  private ownTeacherId(user: AuthUser): string {
    if (!user.teacherId) throw new ForbiddenException('Учётная запись не связана с преподавателем');
    return user.teacherId;
  }

  private assertTeacher(id: string, user: AuthUser) {
    if (user.role === UserRole.TEACHER && user.teacherId !== id) {
      throw new ForbiddenException('Преподаватель может просматривать только свою нагрузку');
    }
  }
}
