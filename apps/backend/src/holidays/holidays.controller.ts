import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EDITOR_ROLES, Roles, STAFF_ROLES } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import {
  CreateHolidayDto,
  CreateTransferDto,
  UpdateHolidayDto,
  UpdateHolidaySettingsDto,
} from './dto/holidays.dto';
import { HolidaysService } from './holidays.service';

@ApiTags('Праздники')
@ApiBearerAuth()
@Controller('holidays')
export class HolidaysController {
  constructor(private readonly holidays: HolidaysService) {}

  @Get('calendar/:year')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Производственный календарь года: праздники, переносы, сокращённые дни' })
  calendar(@Param('year', ParseIntPipe) year: number, @CurrentUser() user: AuthUser) {
    return this.holidays.calendar(user, year);
  }

  @Post('calendar/:year/apply')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Добавить нерабочие дни года в календарный график' })
  apply(@Param('year', ParseIntPipe) year: number, @CurrentUser() user: AuthUser) {
    return this.holidays.apply(user, year);
  }

  @Get()
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Справочник праздников: постоянные и разовые' })
  list(@CurrentUser() user: AuthUser) {
    return this.holidays.listHolidays(user);
  }

  @Post()
  @Roles(...EDITOR_ROLES)
  create(@Body() dto: CreateHolidayDto, @CurrentUser() user: AuthUser) {
    return this.holidays.createHoliday(dto, user);
  }

  @Get('transfers')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Переносы выходных дней' })
  @ApiQuery({ name: 'year', required: false })
  transfers(@CurrentUser() user: AuthUser, @Query('year') year?: string) {
    return this.holidays.listTransfers(user, year ? Number(year) : undefined);
  }

  @Post('transfers')
  @Roles(...EDITOR_ROLES)
  createTransfer(@Body() dto: CreateTransferDto, @CurrentUser() user: AuthUser) {
    return this.holidays.createTransfer(dto, user);
  }

  @Delete('transfers/:id')
  @Roles(...EDITOR_ROLES)
  removeTransfer(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.holidays.removeTransfer(id, user);
  }

  @Put('settings')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Правило переноса по ст. 112 ТК РФ' })
  updateSettings(@Body() dto: UpdateHolidaySettingsDto, @CurrentUser() user: AuthUser) {
    return this.holidays.updateSettings(dto.autoTransfer, user);
  }

  @Post('restore-defaults')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Восстановить федеральные праздники и переносы по постановлениям' })
  restoreDefaults(@CurrentUser() user: AuthUser) {
    return this.holidays.restoreDefaults(user);
  }

  @Patch(':id')
  @Roles(...EDITOR_ROLES)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHolidayDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.holidays.updateHoliday(id, dto, user);
  }

  @Delete(':id')
  @Roles(...EDITOR_ROLES)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.holidays.removeHoliday(id, user);
  }
}
