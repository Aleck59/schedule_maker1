import { useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { LessonDialog } from '@/components/schedule/lesson-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApi, useApiMutation } from '@/lib/query';
import type { Notification } from '@/lib/types';
import { cn } from '@/lib/utils';

const TYPE_LABELS: Record<string, string> = {
  SCHEDULE_PUBLISHED: 'Публикация',
  LESSON_CREATED: 'Новое занятие',
  LESSON_UPDATED: 'Изменение',
  LESSON_CANCELLED: 'Отмена',
  LESSON_MOVED: 'Перенос',
  TEACHER_SUBSTITUTED: 'Замена',
  GENERAL: 'Общее',
};

export default function NotificationsPage() {
  const list = useApi<Notification[]>(['notifications', 'list'], '/notifications');
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const read = useApiMutation((id: string) => api.post(`/notifications/${id}/read`), { invalidate: [['notifications']] });
  const readAll = useApiMutation(() => api.post('/notifications/read-all'), { success: 'Все уведомления прочитаны', invalidate: [['notifications']] });
  const items = (list.data ?? []).filter((n) => !onlyUnread || !n.isRead);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Уведомления"
        description="Публикация расписания, отмены, переносы и замены занятий"
        actions={
          <>
            <Button variant={onlyUnread ? 'secondary' : 'outline'} onClick={() => setOnlyUnread(!onlyUnread)}>
              Только непрочитанные
            </Button>
            <Button variant="outline" onClick={() => readAll.mutate(undefined)}>
              <CheckCheck /> Прочитать все
            </Button>
          </>
        }
      />
      {list.isLoading ? (
        <LoadingState rows={6} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="Уведомлений нет" />
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <Card
              key={n.id}
              className={cn('cursor-pointer py-3 transition hover:shadow-md', !n.isRead && 'border-primary/40 bg-primary/[0.03]')}
              onClick={() => {
                if (!n.isRead) read.mutate(n.id);
                if (n.scheduleLessonId) setLessonId(n.scheduleLessonId);
              }}
            >
              <CardContent className="flex items-start gap-3 px-4">
                <div className={cn('mt-0.5 rounded-full p-2', n.isRead ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary')}>
                  <Bell className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{n.title}</span>
                    <Badge variant="secondary">{TYPE_LABELS[n.type] ?? n.type}</Badge>
                    {!n.isRead && <Badge>Новое</Badge>}
                  </div>
                  <div className="text-muted-foreground mt-0.5 text-sm">{n.message}</div>
                </div>
                <div className="text-muted-foreground shrink-0 text-xs">{formatDateTime(n.createdAt)}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <LessonDialog lessonId={lessonId} open={!!lessonId} onOpenChange={(o) => !o && setLessonId(null)} />
    </div>
  );
}
