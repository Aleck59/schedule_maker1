import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { loadConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, JwtPayload } from '../common/types/auth-user';
import { LoginDto, RegisterDto } from './dto/auth.dto';

/** '15m' → 900 секунд */
export function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)\s*([smhd]?)$/.exec(ttl.trim());
  if (!match) return 900;
  const value = Number(match[1]);
  const unit = match[2] || 's';
  const factor = unit === 'm' ? 60 : unit === 'h' ? 3600 : unit === 'd' ? 86400 : 1;
  return value * factor;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    organizationId: user.organizationId,
    teacherId: user.teacherId,
    studentGroupId: user.studentGroupId,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

@Injectable()
export class AuthService {
  private readonly config = loadConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase().trim() } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Неверный email или пароль');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Учётная запись заблокирована. Обратитесь к администратору');
    }
    const tokens = await this.issueTokens(user);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), refreshTokenHash: sha256(tokens.refreshToken) },
    });
    await this.audit.log(user.id, 'LOGIN', 'User', user.id);
    return { ...tokens, user: publicUser(user) };
  }

  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, { secret: this.config.jwt.refreshSecret });
    } catch {
      throw new UnauthorizedException('Токен обновления недействителен или истёк');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Токен обновления недействителен');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive || user.refreshTokenHash !== sha256(refreshToken)) {
      throw new UnauthorizedException('Сессия завершена, выполните вход повторно');
    }
    const tokens = await this.issueTokens(user);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenHash: sha256(tokens.refreshToken) },
    });
    return { ...tokens, user: publicUser(user) };
  }

  async logout(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { refreshTokenHash: null } });
    return { success: true };
  }

  async register(dto: RegisterDto, actor: AuthUser) {
    const email = dto.email.toLowerCase().trim();
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) {
      throw new ConflictException('Пользователь с таким email уже существует');
    }
    if (dto.role === UserRole.TEACHER && !dto.teacherId) {
      throw new BadRequestException('Для роли «Преподаватель» необходимо указать карточку преподавателя');
    }
    if (dto.role === UserRole.STUDENT && !dto.studentGroupId) {
      throw new BadRequestException('Для роли «Студент» необходимо указать учебную группу');
    }
    if (dto.teacherId) {
      const linked = await this.prisma.user.findUnique({ where: { teacherId: dto.teacherId } });
      if (linked) {
        throw new ConflictException('Карточка преподавателя уже связана с другим пользователем');
      }
    }
    const user = await this.prisma.user.create({
      data: {
        organizationId: actor.organizationId,
        email,
        fullName: dto.fullName.trim(),
        role: dto.role,
        passwordHash: await bcrypt.hash(dto.password, 10),
        teacherId: dto.role === UserRole.TEACHER ? (dto.teacherId ?? null) : null,
        studentGroupId: dto.role === UserRole.STUDENT ? (dto.studentGroupId ?? null) : null,
      },
    });
    await this.audit.log(actor.id, 'CREATE', 'User', user.id, null, publicUser(user));
    return publicUser(user);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        teacher: { select: { id: true, fullName: true } },
        studentGroup: { select: { id: true, code: true } },
        organization: { select: { id: true, name: true, shortName: true, timezone: true } },
      },
    });
    if (!user) {
      throw new UnauthorizedException('Пользователь не найден');
    }
    return {
      ...publicUser(user),
      teacher: user.teacher,
      studentGroup: user.studentGroup,
      organization: user.organization,
    };
  }

  private async issueTokens(user: User) {
    const accessTtl = ttlToSeconds(this.config.jwt.accessTtl);
    const refreshTtl = ttlToSeconds(this.config.jwt.refreshTtl);
    const base = { sub: user.id, role: user.role, org: user.organizationId };
    const accessToken = await this.jwt.signAsync(
      { ...base, type: 'access' } satisfies JwtPayload,
      { secret: this.config.jwt.accessSecret, expiresIn: accessTtl },
    );
    const refreshToken = await this.jwt.signAsync(
      { ...base, type: 'refresh', jti: sha256(`${user.id}:${Date.now()}:${Math.random()}`).slice(0, 16) },
      { secret: this.config.jwt.refreshSecret, expiresIn: refreshTtl },
    );
    return { accessToken, refreshToken, expiresIn: accessTtl };
  }
}
