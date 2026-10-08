import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ALL_ROLES, Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { DashboardService } from './dashboard.service';

@ApiTags('Дашборд')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Показатели главной страницы (зависят от роли пользователя)' })
  get(@CurrentUser() user: AuthUser) {
    return this.dashboard.get(user);
  }
}
