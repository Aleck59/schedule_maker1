import { Injectable, Logger } from '@nestjs/common';
import { NotificationType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Уведомления студентам и преподавателям об изменениях расписания */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Рассылка студентам группы и преподавателям */
  async notify(params: {
    type: NotificationType;
    title: string;
    message: string;
    groupIds?: string[];
    teacherIds?: Array<string | null | undefined>;
    lessonId?: string | null;
  }): Promise<number> {
    try {
      const teacherIds = (params.teacherIds ?? []).filter((x): x is string => !!x);
      const users = await this.prisma.user.findMany({
        where: {
          isActive: true,
          OR: [
            params.groupIds?.length ? { role: UserRole.STUDENT, studentGroupId: { in: params.groupIds } } : undefined,
            teacherIds.length ? { role: UserRole.TEACHER, teacherId: { in: teacherIds } } : undefined,
          ].filter((x): x is NonNullable<typeof x> => !!x),
        },
        select: { id: true },
      });
      if (users.length === 0) return 0;
      await this.prisma.notification.createMany({
        data: users.map((u) => ({
          userId: u.id,
          type: params.type,
          title: params.title,
          message: params.message,
          scheduleLessonId: params.lessonId ?? null,
        })),
      });
      return users.length;
    } catch (e) {
      this.logger.warn(`Не удалось создать уведомления: ${(e as Error).message}`);
      return 0;
    }
  }

  list(userId: string, onlyUnread = false, take = 50) {
    return this.prisma.notification.findMany({
      where: { userId, isRead: onlyUnread ? false : undefined },
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, 200),
    });
  }

  async unreadCount(userId: string) {
    return { count: await this.prisma.notification.count({ where: { userId, isRead: false } }) };
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId }, data: { isRead: true } });
    return { success: true };
  }

  async markAllRead(userId: string) {
    const r = await this.prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
    return { updated: r.count };
  }
}
