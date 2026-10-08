import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ALL_ROLES, Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { ReplaceLessonTimesDto, UpdateOrganizationDto, UpdateSettingsDto } from './dto/settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('Настройки')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'Настройки организации, расписание звонков' })
  get(@CurrentUser() user: AuthUser) {
    return this.settings.getAll(user.organizationId);
  }

  @Patch()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Изменение общих настроек расписания' })
  update(@Body() dto: UpdateSettingsDto, @CurrentUser() user: AuthUser) {
    return this.settings.update(user.organizationId, dto, user);
  }

  @Patch('organization')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Изменение реквизитов организации' })
  updateOrganization(@Body() dto: UpdateOrganizationDto, @CurrentUser() user: AuthUser) {
    return this.settings.updateOrganization(user.organizationId, dto, user);
  }

  @Put('lesson-times')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Замена расписания звонков' })
  replaceLessonTimes(@Body() dto: ReplaceLessonTimesDto, @CurrentUser() user: AuthUser) {
    return this.settings.replaceLessonTimes(user.organizationId, dto, user);
  }
}
