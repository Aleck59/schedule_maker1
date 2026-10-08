import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditService } from './audit.service';

@ApiTags('Журнал аудита')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Журнал действий пользователей' })
  @ApiQuery({ name: 'entityType', required: false })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'take', required: false })
  @ApiQuery({ name: 'skip', required: false })
  list(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.audit.list({
      entityType,
      entityId,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }
}
