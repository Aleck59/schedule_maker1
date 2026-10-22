import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EDITOR_ROLES, Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { ConflictFixesService } from './conflict-fixes.service';
import { ApplyFixDto } from './dto/conflict-fix.dto';

@ApiTags('Проверка расписания')
@ApiBearerAuth()
@Controller('schedule-periods')
export class ConflictFixesController {
  constructor(private readonly fixes: ConflictFixesService) {}

  @Get(':id/fixes')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({
    summary:
      'Предложения по устранению конфликтов: перенос в свободный слот, другая аудитория, замена преподавателя, удаление дубликатов и лишних занятий',
  })
  suggest(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.fixes.suggest(id, user);
  }

  @Post(':id/fixes/apply')
  @HttpCode(200)
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Применить предложенное исправление' })
  apply(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApplyFixDto, @CurrentUser() user: AuthUser) {
    return this.fixes.apply(id, dto, user);
  }

  @Post(':id/fixes/auto')
  @HttpCode(200)
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Исправить все ошибки автоматически (первым подходящим вариантом)' })
  auto(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.fixes.autoFix(id, user);
  }
}
