import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Журнал действий пользователей */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(
    userId: string | null | undefined,
    action: string,
    entityType: string,
    entityId?: string | null,
    oldData?: unknown,
    newData?: unknown,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: userId ?? null,
          action,
          entityType,
          entityId: entityId ?? null,
          oldDataJson: toJson(oldData),
          newDataJson: toJson(newData),
        },
      });
    } catch (e) {
      // Журнал не должен ломать основную операцию
      this.logger.warn(`Не удалось записать журнал аудита: ${(e as Error).message}`);
    }
  }

  async list(params: {
    entityType?: string;
    entityId?: string;
    userId?: string;
    take?: number;
    skip?: number;
  }) {
    const where: Prisma.AuditLogWhereInput = {
      entityType: params.entityType || undefined,
      entityId: params.entityId || undefined,
      userId: params.userId || undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(params.take ?? 50, 500),
        skip: params.skip ?? 0,
        include: { user: { select: { id: true, fullName: true, email: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  }
}
