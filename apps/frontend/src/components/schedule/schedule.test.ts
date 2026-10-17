import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { issuesFromError } from './issues-list';
import { weekColumns } from './week-grid';

describe('сетка расписания', () => {
  it('колонки недели: только учебные дни, отметка заблокированных дат', () => {
    const cols = weekColumns('2026-09-21', [1, 2, 3, 4, 5, 6], { '2026-09-23': 'Праздничный день' });
    expect(cols.map((c) => c.date)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
    ]);
    expect(cols[0].title).toBe('Понедельник');
    expect(cols[2].blocked).toBe('Праздничный день');
    expect(cols[1].blocked).toBeNull();
  });

  it('пятидневная неделя без субботы', () => {
    const cols = weekColumns('2026-09-21', [1, 2, 3, 4, 5]);
    expect(cols).toHaveLength(5);
    expect(cols.at(-1)?.date).toBe('2026-09-25');
  });
});

describe('конфликты при сохранении', () => {
  const issue = {
    severity: 'ERROR' as const,
    validationType: 'GROUP_CONFLICT',
    entityType: 'ScheduleLesson',
    entityId: null,
    message: 'У группы уже есть занятие в это время',
  };

  it('ответ 409 со списком конфликтов', () => {
    const error = new ApiError(409, 'Обнаружены конфликты', [issue.message], { issues: [issue] });
    expect(issuesFromError(error)).toEqual([issue]);
  });

  it('другие ошибки не считаются конфликтами', () => {
    expect(issuesFromError(new ApiError(400, 'Ошибка валидации'))).toBeNull();
    expect(issuesFromError(new ApiError(409, 'Результат уже применён'))).toBeNull();
    expect(issuesFromError(new Error('сеть'))).toBeNull();
  });
});
