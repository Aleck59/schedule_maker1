import { UserRole } from '@prisma/client';

/** Данные пользователя из JWT, доступные в контроллерах */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  organizationId: string;
  teacherId: string | null;
  studentGroupId: string | null;
}

export interface JwtPayload {
  sub: string;
  role: UserRole;
  org: string;
  type: 'access' | 'refresh';
}
