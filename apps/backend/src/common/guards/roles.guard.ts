import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthUser } from '../types/auth-user';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Закрыто по умолчанию: эндпоинт без @Roles (и без @Public) недоступен никому,
    // чтобы забытый декоратор не открывал новый метод всем вошедшим, включая студентов.
    if (!roles || roles.length === 0) {
      throw new ForbiddenException('Доступ к методу не настроен');
    }
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException('Недостаточно прав для выполнения операции');
    }
    return true;
  }
}
