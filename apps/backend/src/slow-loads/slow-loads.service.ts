import { Injectable } from '@nestjs/common';
import { AuthUser } from '../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSlowLoadDto } from './slow-loads.dto';

/** Записи старше этого срока удаляются при очередной записи */
const KEEP_DAYS = 90;

/** Журнал долгих загрузок страниц */
@Injectable()
export class SlowLoadsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSlowLoadDto, user: AuthUser) {
    await this.prisma.slowLoadLog.deleteMany({
      where: {
        organizationId: user.organizationId,
        createdAt: { lt: new Date(Date.now() - KEEP_DAYS * 24 * 3600 * 1000) },
      },
    });
    return this.prisma.slowLoadLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        page: dto.page,
        requests: [...new Set(dto.requests)],
        durationMs: dto.durationMs,
        outcome: dto.outcome,
      },
      select: { id: true },
    });
  }

  async list(user: AuthUser, take = 50, skip = 0) {
    const where = { organizationId: user.organizationId };
    const [items, total] = await Promise.all([
      this.prisma.slowLoadLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(1, take), 500),
        skip: Math.max(0, skip),
        include: { user: { select: { id: true, fullName: true, email: true } } },
      }),
      this.prisma.slowLoadLog.count({ where }),
    ]);
    return { items, total };
  }

  async clear(user: AuthUser) {
    const { count } = await this.prisma.slowLoadLog.deleteMany({
      where: { organizationId: user.organizationId },
    });
    return { deleted: count };
  }
}
