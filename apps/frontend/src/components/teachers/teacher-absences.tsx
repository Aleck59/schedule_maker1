import { useState } from 'react';
import { Plane, Plus, Trash2 } from 'lucide-react';
import { Confirm } from '@/components/common/confirm';
import { Field } from '@/components/common/field';
import { Spinner } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { formatRange, today } from '@/lib/format';
import { useApi, useApiMutation } from '@/lib/query';
import type { CalendarEvent } from '@/lib/types';

const REASONS = ['Отпуск', 'Курсы повышения квалификации', 'Больничный', 'Командировка'];

/** Отсутствия преподавателя (отпуск, курсы, больничный): в эти дни занятия ему не ставятся */
export function TeacherAbsences({ teacherId, editable }: { teacherId: string; editable: boolean }) {
  const events = useApi<CalendarEvent[]>(['calendar-events', 'teacher', teacherId], '/calendar-events', { teacherId });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(REASONS[0]!);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const add = useApiMutation(
    () => api.post('/calendar-events', { teacherId, eventType: 'OTHER', title, startDate: from, endDate: to, blocksSchedule: true }),
    {
      success: 'Отсутствие добавлено',
      invalidate: [['calendar-events'], ['teacher']],
      onSuccess: () => setOpen(false),
    },
  );
  const remove = useApiMutation((id: string) => api.delete(`/calendar-events/${id}`), {
    success: 'Отсутствие удалено',
    invalidate: [['calendar-events']],
  });
  const list = (events.data ?? []).filter((e) => e.teacherId === teacherId);
  return (
    <div className="space-y-2">
      {list.length === 0 && !events.isLoading && <p className="text-muted-foreground text-sm">Отпусков, курсов и других отсутствий нет.</p>}
      {list.map((e) => (
        <div key={e.id} className="flex items-center gap-3 rounded-lg border p-2.5">
          <Plane className="text-muted-foreground size-4" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium">{e.title}</div>
            <div className="text-muted-foreground text-xs">{formatRange(e.startDate, e.endDate)} — занятия не ставятся</div>
          </div>
          {editable && (
            <Confirm
              trigger={
                <Button variant="ghost" size="icon-sm" aria-label="Удалить отсутствие">
                  <Trash2 />
                </Button>
              }
              title="Удалить отсутствие?"
              description={`${e.title}: ${formatRange(e.startDate, e.endDate)}`}
              destructive
              confirmText="Удалить"
              onConfirm={() => remove.mutate(e.id)}
            />
          )}
        </div>
      ))}
      {editable && (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plus /> Отпуск, курсы, больничный
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Отсутствие преподавателя</DialogTitle>
            <DialogDescription>В эти дни генератор не ставит занятия, а проверка расписания покажет уже поставленные.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="Причина">
              <Input list="absence-reasons" value={title} onChange={(e) => setTitle(e.target.value)} />
              <datalist id="absence-reasons">
                {REASONS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="С">
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="По" error={to < from ? 'Раньше даты начала' : undefined}>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button disabled={!title.trim() || !from || !to || to < from || add.isPending} onClick={() => add.mutate(undefined)}>
              {add.isPending && <Spinner />} Добавить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
