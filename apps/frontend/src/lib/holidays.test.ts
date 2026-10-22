import { describe, expect, it } from 'vitest';
import { holidayDateLabel, monthMatrix } from './holidays';

describe('monthMatrix', () => {
  it('март 2026 начинается с воскресенья', () => {
    const cells = monthMatrix(2026, 2);
    expect(cells.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(cells[6]).toEqual({ date: '2026-03-01', day: 1, weekday: 7 });
    expect(cells.filter(Boolean)).toHaveLength(31);
    expect(cells.find((c) => c?.day === 9)?.weekday).toBe(1);
  });

  it('февраль високосного года', () => {
    expect(monthMatrix(2028, 1).filter(Boolean)).toHaveLength(29);
  });
});

describe('holidayDateLabel', () => {
  it('постоянный и разовый праздник', () => {
    expect(holidayDateLabel({ month: 2, day: 23, date: null })).toBe('23 февраля');
    expect(holidayDateLabel({ month: null, day: null, date: '2026-03-20' })).toBe('20.03.2026');
  });
});
