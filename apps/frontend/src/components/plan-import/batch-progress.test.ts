import { describe, expect, it } from 'vitest';
import { batchCards } from './batch-progress';
import type { CurriculumScan } from './types';

const scan = (id: string, status: CurriculumScan['status'], progress: number, message: string | null = null): CurriculumScan => ({
  id,
  fileNames: [`${id}.plx`],
  status,
  progress,
  message,
  error: null,
  programId: status === 'APPLIED' ? `p-${id}` : null,
  createdAt: '',
  updatedAt: '',
});

describe('последовательная пакетная загрузка', () => {
  it('карточка на каждый файл: отправка, обработка, итог', () => {
    const cards = batchCards(
      [scan('a', 'APPLIED', 1, 'Учебный план создан'), scan('b', 'PROCESSING', 0.5, 'Создание учебного плана')],
      [
        { key: '0', name: 'a.plx', size: 1, phase: 'sent', uploaded: 1, scanId: 'a' },
        { key: '1', name: 'b.plx', size: 1, phase: 'sent', uploaded: 1, scanId: 'b' },
        { key: '2', name: 'c.plx', size: 1, phase: 'uploading', uploaded: 0.4 },
        { key: '5', name: 'f.plx', size: 1, phase: 'sent', uploaded: 1, scanId: 'не-в-списке' },
        { key: '3', name: 'd.plx', size: 1, phase: 'queued', uploaded: 0 },
        { key: '4', name: 'e.plx', size: 1, phase: 'error', uploaded: 0, error: 'Файл слишком большой' },
      ],
    );
    expect(cards.map((c) => [c.name, c.key, c.percent])).toEqual([
      ['a.plx', 'done', 100],
      ['b.plx', 'work', 75],
      ['c.plx', 'upload', 20],
      ['f.plx', 'work', 50],
      ['d.plx', 'queue', 0],
      ['e.plx', 'fail', 100],
    ]);
    expect(cards[0].programId).toBe('p-a');
    expect(cards[5].details).toBe('Файл слишком большой');
  });

  it('без файлов в браузере — по данным сервера', () => {
    const cards = batchCards([scan('x', 'READY', 1, 'Нужна проверка: план уже есть')], []);
    expect(cards).toMatchObject([{ key: 'review', details: 'план уже есть', scanId: 'x' }]);
  });
});
