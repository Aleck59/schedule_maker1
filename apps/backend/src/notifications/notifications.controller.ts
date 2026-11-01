import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ALL_ROLES, Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { NotificationsService } from './notifications.service';

@ApiTags('Уведомления')
@ApiBearerAuth()
@Roles(...ALL_ROLES)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Мои уведомления (отмены, переносы, замены)' })
  @ApiQuery({ name: 'unread', required: false, type: Boolean })
  list(@CurrentUser() user: AuthUser, @Query('unread') unread?: string) {
    return this.notifications.list(user.id, unread === 'true');
  }

  @Get('unread-count')
  unread(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user.id);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.notifications.markRead(user.id, id);
  }
}
