import { DEFAULT_PRINT_FORM } from '../export/schedule-form';
import { formToPdfDefinition } from './form-writers';
import { parseFormContent, renderForm } from './report-form';
import { buildScheduleBlank, buildWeekFields, isWeekSlotField, SCHEDULE_WEEK_SOURCE } from './schedule-week';

const groups = [
  { id: 'a', code: 'ЮР-25-1', courseNumber: 2, semesterNumber: 3 },
  { id: 'b', code: 'ЮР-25-2', courseNumber: 2, semesterNumber: 3 },
];
const days = ['2026-11-02', '2026-11-03'];
const lesson = (
  groupId: string,
  date: string,
  n: number,
  subject: string,
  room: string,
  teacher = 'Иванов Иван Иванович',
) => ({
  groupId,
  date,
  lessonNumber: n,
  subgroupNumber: null,
  subject,
  teacher,
  room,
  lessonType: 'PRACTICAL',
});

describe('бланк расписания недели', () => {
  const lessons = [
    lesson('a', days[0], 1, 'История России', '31'),
    lesson('b', days[0], 1, 'История России', '31'),
    lesson('a', days[0], 2, 'Право', '34'),
    lesson('b', days[0], 2, 'Экономика', '16', 'Петрова Анна Сергеевна'),
  ];
  const fields = buildWeekFields({
    meta: {
      specialtyCode: '40.02.04',
      specialtyName: 'Юриспруденция',
      higherEducation: false,
      profile: 'Социально-экономический',
      studyForm: 'FULL_TIME',
      educationBase: 'BASIC_GENERAL',
      academicYear: '2026-2027',
      weekNumber: 10,
    },
    groups,
    days,
    lessons,
    lessonTimes: [
      { lessonNumber: 1, startTime: '08:30' },
      { lessonNumber: 2, startTime: '10:00' },
    ],
    print: { ...DEFAULT_PRINT_FORM, footerName: 'Петрова А.С.' },
  });

  it('поля: дни, группы, пары с преподавателем и аудиторией, неделя 1/2', () => {
    expect(fields['d1.weekday']).toBe('ПОНЕДЕЛЬНИК');
    expect(fields['d1.date']).toBe('02.11.2026');
    expect(fields['g2.number']).toBe(2);
    expect(fields['g1.d1.p2']).toBe('Право\nПреподаватель Иванов И.И.');
    expect(fields['g2.d1.p2.room']).toBe('16');
    expect(fields['g1.room']).toBe('31');
    expect(fields['week.parity']).toBe(2);
    expect(fields['week.start']).toBe('8.30');
    expect(fields['spec.base']).toBe('на базе основного общего образования');
    expect(isWeekSlotField('g3.d6.p4.room')).toBe(true);
  });

  it('готовый бланк: общая пара двух групп склеивается, свободные пары пустые, день подписан вертикально', () => {
    const blank = buildScheduleBlank({ groups, layout: 'rooms', pairs: 3, days: 2, approvals: 2 });
    expect(blank.dataSource).toBe(SCHEDULE_WEEK_SOURCE);
    const form = parseFormContent(blank, [SCHEDULE_WEEK_SOURCE]);
    const sheet = renderForm(form, {
      fields: { ...fields, 'org.shortName': 'филиала колледжа в г. Энске', year: 2026 },
      table: null,
      fallback: (n) => (isWeekSlotField(n) || /^(g|d)\d+\./.test(n) ? '' : undefined),
    });
    expect(sheet.unknownFields).toEqual([]);
    const flat = sheet.rows.map((r) => r.map((c) => c.v));
    const r1 = flat.findIndex((r) => r.includes('История России\nПреподаватель Иванов И.И.'));
    expect(r1).toBeGreaterThan(0);
    // общая пара: один объединённый блок от текста 1-й группы до текста 2-й, аудитория — в последнем столбце
    const m = sheet.merges.find((x) => x.r === r1 && x.c === 1)!;
    expect(m.cs).toBe(5);
    expect(flat[r1][6]).toBe('31');
    // разные пары не склеиваются
    const r2 = r1 + 1;
    expect(flat[r2][1]).toBe('Право\nПреподаватель Иванов И.И.');
    expect(flat[r2][4]).toBe('Экономика\nПреподаватель Петрова А.С.');
    // день недели — вертикальная подпись на 3 строки
    const day = sheet.merges.find((x) => x.r === r1 && x.c === 0)!;
    expect(day.rs).toBe(3);
    expect(sheet.rows[r1][0].s?.rot).toBe(true);
    const def = JSON.stringify(formToPdfDefinition(sheet, 'Бланк'));
    expect(def).toContain('rotate(-90)');
  });

  it('заочный бланк: аудитория в шапке, без столбцов аудиторий', () => {
    const blank = buildScheduleBlank({ groups, layout: 'header-room', pairs: 4, days: 6, approvals: 3 });
    expect(blank.colCount).toBe(5);
    expect(Object.values(blank.cells).some((c) => c.v === '{{g2.room}} аудитория')).toBe(true);
    expect(Object.values(blank.cells).some((c) => c.v === '{{approval3.heading}}')).toBe(true);
  });
});
