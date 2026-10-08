import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Ограничение доступа по ролям */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Роли, которым разрешено редактировать данные расписания и учебных планов */
export const EDITOR_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.DISPATCHER];
/** Роли с правом просмотра служебных данных */
export const STAFF_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.DISPATCHER,
  UserRole.MANAGER,
  UserRole.TEACHER,
];
/** Все роли */
export const ALL_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.DISPATCHER,
  UserRole.MANAGER,
  UserRole.TEACHER,
  UserRole.STUDENT,
];
