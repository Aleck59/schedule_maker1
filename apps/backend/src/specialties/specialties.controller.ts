import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EDITOR_ROLES, Roles, STAFF_ROLES } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { CreateSpecialtyDto, UpdateSpecialtyDto } from './dto/specialty.dto';
import { SpecialtiesService } from './specialties.service';

@ApiTags('Справочники: специальности')
@ApiBearerAuth()
@Controller('specialties')
export class SpecialtiesController {
  constructor(private readonly service: SpecialtiesService) {}

  @Get()
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Список специальностей' })
  list() {
    return this.service.list();
  }

  @Get(':id')
  @Roles(...STAFF_ROLES)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(id);
  }

  @Post()
  @Roles(...EDITOR_ROLES)
  create(@Body() dto: CreateSpecialtyDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @Roles(...EDITOR_ROLES)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSpecialtyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(...EDITOR_ROLES)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
