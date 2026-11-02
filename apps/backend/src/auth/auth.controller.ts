import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { CacheResponse, NoCacheInvalidate } from '../cache/cache.decorators';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';

@ApiTags('Аутентификация')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @NoCacheInvalidate()
  @HttpCode(200)
  @ApiOperation({ summary: 'Вход по email и паролю' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post('refresh')
  @NoCacheInvalidate()
  @HttpCode(200)
  @ApiOperation({ summary: 'Обновление пары токенов' })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Roles(UserRole.ADMIN)
  @Post('register')
  @ApiOperation({ summary: 'Регистрация пользователя (только администратор)' })
  register(@Body() dto: RegisterDto, @CurrentUser() user: AuthUser) {
    return this.auth.register(dto, user);
  }

  @ApiBearerAuth()
  @Get('me')
  @CacheResponse(60, 'user')
  @ApiOperation({ summary: 'Профиль текущего пользователя' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @ApiBearerAuth()
  @Post('logout')
  @NoCacheInvalidate()
  @HttpCode(200)
  @ApiOperation({ summary: 'Выход (отзыв токена обновления)' })
  logout(@CurrentUser() user: AuthUser) {
    return this.auth.logout(user.id);
  }
}
