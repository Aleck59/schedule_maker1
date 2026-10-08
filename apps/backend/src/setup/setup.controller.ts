import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EDITOR_ROLES, Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { SetupService } from './setup.service';

@ApiTags('Мастер настройки')
@ApiBearerAuth()
@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get('status')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Шаги подготовки расписания: что сделано и что делать дальше' })
  status(@CurrentUser() user: AuthUser) {
    return this.setup.status(user);
  }
}
