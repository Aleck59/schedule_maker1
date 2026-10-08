import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ReplaceAvailabilityDto } from '../common/dto/availability.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EDITOR_ROLES, Roles, STAFF_ROLES } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { AvailabilityRulesService } from './availability-rules.service';
import { AvailabilityRuleDto, UpdateAvailabilityRuleDto } from './dto/availability-rule.dto';
import { CreateTeacherDto, UpdateTeacherDto } from './dto/teachers.dto';
import { TeachersService } from './teachers.service';

@ApiTags('Преподаватели')
@ApiBearerAuth()
@Controller('teachers')
export class TeachersController {
  constructor(
    private readonly teachers: TeachersService,
    private readonly rules: AvailabilityRulesService,
  ) {}

  /** Преподаватель управляет только своими правилами и сеткой */
  private checkOwn(user: AuthUser, teacherId: string) {
    if (user.role === UserRole.TEACHER && user.teacherId !== teacherId) {
      throw new ForbiddenException('Преподаватель может изменять только свою доступность');
    }
  }

  @Get()
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Список преподавателей' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'department', required: false })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  list(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('department') department?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.teachers.list(user, {
      search,
      department,
      isActive: isActive === undefined || isActive === '' ? undefined : isActive === 'true',
    });
  }

  @Post()
  @Roles(...EDITOR_ROLES)
  create(@Body() dto: CreateTeacherDto, @CurrentUser() user: AuthUser) {
    return this.teachers.create(dto, user);
  }

  @Get(':id')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Карточка преподавателя: доступность, закреплённые дисциплины' })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.teachers.get(id, user);
  }

  @Patch(':id')
  @Roles(...EDITOR_ROLES)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeacherDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.teachers.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(...EDITOR_ROLES)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.teachers.remove(id, user);
  }

  @Get(':id/availability')
  @Roles(...STAFF_ROLES)
  getAvailability(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.teachers.getAvailability(id, user);
  }

  @Post(':id/availability')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.TEACHER)
  @ApiOperation({ summary: 'Замена сетки доступности преподавателя (преподаватель может менять свою)' })
  replaceAvailability(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceAvailabilityDto,
    @CurrentUser() user: AuthUser,
  ) {
    this.checkOwn(user, id);
    return this.teachers.replaceAvailability(id, dto, user);
  }

  @Get(':id/availability-rules')
  @Roles(...STAFF_ROLES, UserRole.TEACHER)
  @ApiOperation({ summary: 'Гибкие правила доступности преподавателя (с описанием на русском)' })
  listRules(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    if (user.role === UserRole.TEACHER) this.checkOwn(user, id);
    return this.rules.list(id, user);
  }

  @Post(':id/availability-rules')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.TEACHER)
  @ApiOperation({
    summary:
      'Добавить правило: «не может» / «только» / «желательно» / «нежелательно» / «онлайн» — дни, пары или время, чётность, недели месяца, период',
  })
  createRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AvailabilityRuleDto,
    @CurrentUser() user: AuthUser,
  ) {
    this.checkOwn(user, id);
    return this.rules.create(id, dto, user);
  }

  @Post(':id/availability-rules/preview')
  @HttpCode(200)
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.TEACHER)
  @ApiOperation({ summary: 'Предпросмотр правила: описание и ближайшие даты, к которым оно применяется' })
  @ApiQuery({ name: 'from', required: false, description: 'Дата начала просмотра (по умолчанию — сегодня)' })
  previewRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AvailabilityRuleDto,
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
  ) {
    this.checkOwn(user, id);
    return this.rules.preview(id, dto, user, from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : undefined);
  }

  @Patch(':id/availability-rules/:ruleId')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.TEACHER)
  @ApiOperation({ summary: 'Изменить правило доступности' })
  updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body() dto: UpdateAvailabilityRuleDto,
    @CurrentUser() user: AuthUser,
  ) {
    this.checkOwn(user, id);
    return this.rules.update(id, ruleId, dto, user);
  }

  @Delete(':id/availability-rules/:ruleId')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.TEACHER)
  @ApiOperation({ summary: 'Удалить правило доступности' })
  removeRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentUser() user: AuthUser,
  ) {
    this.checkOwn(user, id);
    return this.rules.remove(id, ruleId, user);
  }
}
