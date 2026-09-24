import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
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
import { CreateTeacherDto, UpdateTeacherDto } from './dto/teachers.dto';
import { TeachersService } from './teachers.service';

@ApiTags('Преподаватели')
@ApiBearerAuth()
@Controller('teachers')
export class TeachersController {
  constructor(private readonly teachers: TeachersService) {}

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
    if (user.role === UserRole.TEACHER && user.teacherId !== id) {
      throw new ForbiddenException('Преподаватель может изменять только свою доступность');
    }
    return this.teachers.replaceAvailability(id, dto, user);
  }
}
