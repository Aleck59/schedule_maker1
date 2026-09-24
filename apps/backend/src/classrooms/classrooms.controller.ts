import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClassroomType } from '@prisma/client';
import { ReplaceAvailabilityDto } from '../common/dto/availability.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EDITOR_ROLES, Roles, STAFF_ROLES } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { ClassroomsService } from './classrooms.service';
import { CreateClassroomDto, UpdateClassroomDto } from './dto/classrooms.dto';

@ApiTags('Аудитории')
@ApiBearerAuth()
@Controller('classrooms')
export class ClassroomsController {
  constructor(private readonly classrooms: ClassroomsService) {}

  @Get()
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Аудиторный фонд' })
  @ApiQuery({ name: 'type', enum: ClassroomType, required: false })
  @ApiQuery({ name: 'building', required: false })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({ name: 'minCapacity', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false })
  list(
    @CurrentUser() user: AuthUser,
    @Query('type') type?: ClassroomType,
    @Query('building') building?: string,
    @Query('isActive') isActive?: string,
    @Query('minCapacity') minCapacity?: string,
    @Query('search') search?: string,
  ) {
    return this.classrooms.list(user, {
      type,
      building,
      isActive: isActive === undefined || isActive === '' ? undefined : isActive === 'true',
      minCapacity: minCapacity ? Number(minCapacity) : undefined,
      search,
    });
  }

  @Get('buildings')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Список корпусов' })
  buildings(@CurrentUser() user: AuthUser) {
    return this.classrooms.buildings(user);
  }

  @Post()
  @Roles(...EDITOR_ROLES)
  create(@Body() dto: CreateClassroomDto, @CurrentUser() user: AuthUser) {
    return this.classrooms.create(dto, user);
  }

  @Get(':id')
  @Roles(...STAFF_ROLES)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.classrooms.get(id, user);
  }

  @Patch(':id')
  @Roles(...EDITOR_ROLES)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClassroomDto, @CurrentUser() user: AuthUser) {
    return this.classrooms.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(...EDITOR_ROLES)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.classrooms.remove(id, user);
  }

  @Get(':id/availability')
  @Roles(...STAFF_ROLES)
  getAvailability(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.classrooms.getAvailability(id, user);
  }

  @Post(':id/availability')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Замена сетки доступности аудитории' })
  replaceAvailability(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceAvailabilityDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.classrooms.replaceAvailability(id, dto, user);
  }
}
