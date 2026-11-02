import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ALL_ROLES, Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { CreateSlowLoadDto } from './slow-loads.dto';
import { SlowLoadsService } from './slow-loads.service';

@ApiTags('Журнал долгих загрузок')
@ApiBearerAuth()
@Controller('slow-loads')
export class SlowLoadsController {
  constructor(private readonly slowLoads: SlowLoadsService) {}

  @Post()
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Записать долгое ожидание страницы (дольше 15 с)' })
  create(@Body() dto: CreateSlowLoadDto, @CurrentUser() user: AuthUser) {
    return this.slowLoads.create(dto, user);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Журнал долгих загрузок страниц' })
  @ApiQuery({ name: 'take', required: false })
  @ApiQuery({ name: 'skip', required: false })
  list(@CurrentUser() user: AuthUser, @Query('take') take?: string, @Query('skip') skip?: string) {
    return this.slowLoads.list(user, take ? Number(take) || 50 : 50, skip ? Number(skip) || 0 : 0);
  }

  @Delete()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Очистить журнал долгих загрузок' })
  clear(@CurrentUser() user: AuthUser) {
    return this.slowLoads.clear(user);
  }
}
