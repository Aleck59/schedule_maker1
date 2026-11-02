import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { loadConfig } from '../config/configuration';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, JwtPayload } from '../common/types/auth-user';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // Для скачивания файлов (PDF/Excel) по прямой ссылке
        ExtractJwt.fromUrlQueryParameter('access_token'),
      ]),
      ignoreExpiration: false,
      secretOrKey: loadConfig().jwt.accessSecret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Некорректный токен доступа');
    }
    // Пользователь проверяется на каждом запросе: кэш в Redis снимает этот запрос к базе.
    // Запись сбрасывается любым изменением данных (в том числе блокировкой пользователя) и живёт не дольше минуты.
    const key = `auth-user:${payload.sub}`;
    const cached = await this.cache.getVersioned<AuthUser>(key);
    if (cached.value) return cached.value;
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Пользователь не найден или заблокирован');
    }
    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
      teacherId: user.teacherId,
      studentGroupId: user.studentGroupId,
    };
    await this.cache.setVersioned(key, cached.version, authUser, 60);
    return authUser;
  }
}
