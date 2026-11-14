import 'reflect-metadata';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

function context(handler: () => void, cls: object, role?: UserRole): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());
  class Ctl {}

  it('закрывает эндпоинт без @Roles и @Public', () => {
    const handler = () => undefined;
    expect(() => guard.canActivate(context(handler, Ctl, UserRole.ADMIN))).toThrow(ForbiddenException);
  });

  it('пускает только перечисленные роли', () => {
    const handler = () => undefined;
    Reflect.defineMetadata(ROLES_KEY, [UserRole.ADMIN], handler);
    expect(guard.canActivate(context(handler, Ctl, UserRole.ADMIN))).toBe(true);
    expect(() => guard.canActivate(context(handler, Ctl, UserRole.STUDENT))).toThrow(ForbiddenException);
  });

  it('пропускает @Public без пользователя', () => {
    const handler = () => undefined;
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
    expect(guard.canActivate(context(handler, Ctl))).toBe(true);
  });
});

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return controllerFiles(full);
    return name.endsWith('.controller.ts') ? [full] : [];
  });
}

describe('Все эндпоинты API', () => {
  it('имеют @Roles или @Public', () => {
    const missing: string[] = [];
    let total = 0;
    for (const file of controllerFiles(join(__dirname, '..', '..'))) {
      const mod = require(file) as Record<string, unknown>;
      for (const exported of Object.values(mod)) {
        if (typeof exported !== 'function' || Reflect.getMetadata(PATH_METADATA, exported) === undefined)
          continue;
        const cls = exported as { name: string; prototype: Record<string, unknown> };
        const classOk = Reflect.getMetadata(ROLES_KEY, cls) || Reflect.getMetadata(IS_PUBLIC_KEY, cls);
        for (const key of Object.getOwnPropertyNames(cls.prototype)) {
          const method = cls.prototype[key];
          if (key === 'constructor' || typeof method !== 'function') continue;
          if (Reflect.getMetadata(METHOD_METADATA, method) === undefined) continue;
          total++;
          const ok =
            classOk || Reflect.getMetadata(ROLES_KEY, method) || Reflect.getMetadata(IS_PUBLIC_KEY, method);
          if (!ok) missing.push(`${cls.name}.${key}`);
        }
      }
    }
    expect(total).toBeGreaterThan(200);
    expect(missing).toEqual([]);
  });
});
