import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EDITOR_ROLES, Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { CurriculumScansService } from './curriculum-scans.service';
import { ApplyScanDto } from './dto/curriculum-scan.dto';

@ApiTags('Импорт учебного плана со скана')
@ApiBearerAuth()
@Controller('curriculum-scans')
export class CurriculumScansController {
  constructor(private readonly scans: CurriculumScansService) {}

  @Get('status')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Доступность распознавания (Tesseract OCR, русский язык)' })
  status() {
    return this.scans.status();
  }

  @Get()
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Последние загруженные сканы' })
  list(@CurrentUser() user: AuthUser) {
    return this.scans.list(user);
  }

  @Post()
  @Roles(...EDITOR_ROLES)
  @ApiOperation({
    summary: 'Загрузить скан учебного плана (PDF или фотографии страниц) — распознавание выполняется в фоне',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } },
    },
  })
  @UseInterceptors(FilesInterceptor('files', 40, { limits: { fileSize: 60 * 1024 * 1024 } }))
  upload(@UploadedFiles() files: Express.Multer.File[] | undefined, @CurrentUser() user: AuthUser) {
    if (!files?.length) throw new BadRequestException('Файл не передан');
    return this.scans.upload(files, user);
  }

  @Get(':id')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Состояние распознавания и распознанные данные' })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.scans.getWithDraft(id, user);
  }

  @Post(':id/apply')
  @HttpCode(200)
  @Roles(...EDITOR_ROLES)
  @ApiOperation({
    summary:
      'Создать по проверенным данным специальность, учебный план, семестры, дисциплины, календарный график и группу',
  })
  apply(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApplyScanDto, @CurrentUser() user: AuthUser) {
    return this.scans.apply(id, dto, user);
  }

  @Delete(':id')
  @Roles(...EDITOR_ROLES)
  @ApiOperation({ summary: 'Удалить скан' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.scans.remove(id, user);
  }
}
