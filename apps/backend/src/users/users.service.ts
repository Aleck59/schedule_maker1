import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { publicUser } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/users.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, role?: UserRole, search?: string) {
    const users = await this.prisma.user.findMany({
      where: {
        organizationId: actor.organizationId,
        role: role || undefined,
        OR: search
          ? [
              { fullName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ]
          : undefined,
      },
      include: {
        teacher: { select: { id: true, fullName: true } },
        studentGroup: { select: { id: true, code: true } },
      },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
    });
    return users.map((u) => ({ ...publicUser(u), teacher: u.teacher, studentGroup: u.studentGroup }));
  }

  async get(id: string, actor: AuthUser) {
    const user = await this.prisma.user.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    return publicUser(user);
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser) {
    const user = await this.prisma.user.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    if (id === actor.id && (dto.isActive === false || (dto.role && dto.role !== UserRole.ADMIN))) {
      throw new BadRequestException('Нельзя заблокировать себя или снять с себя роль администратора');
    }
    const data: Prisma.UserUncheckedUpdateInput = {};
    if (dto.email !== undefined) {
      const email = dto.email.toLowerCase().trim();
      const exists = await this.prisma.user.findFirst({ where: { email, NOT: { id } } });
      if (exists) throw new ConflictException('Пользователь с таким email уже существует');
      data.email = email;
    }
    if (dto.fullName !== undefined) data.fullName = dto.fullName.trim();
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.teacherId !== undefined) data.teacherId = dto.teacherId;
    if (dto.studentGroupId !== undefined) data.studentGroupId = dto.studentGroupId;
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 10);
      data.refreshTokenHash = null;
    }
    if (dto.isActive === false) data.refreshTokenHash = null;
    const updated = await this.prisma.user.update({ where: { id }, data });
    await this.audit.log(actor.id, 'UPDATE', 'User', id, publicUser(user), publicUser(updated));
    return publicUser(updated);
  }

  async remove(id: string, actor: AuthUser) {
    if (id === actor.id) throw new BadRequestException('Нельзя удалить собственную учётную запись');
    const user = await this.prisma.user.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    await this.prisma.user.delete({ where: { id } });
    await this.audit.log(actor.id, 'DELETE', 'User', id, publicUser(user), null);
    return { success: true };
  }
}
