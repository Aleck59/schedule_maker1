import {
  DEFAULT_PRINT_FORM,
  FormLesson,
  buildFormSheet,
  normalizePrintForm,
  shortTeacherName,
} from './schedule-form';

const lesson = (over: Partial<FormLesson>): FormLesson => ({
  date: '2026-10-19',
  lessonNumber: 1,
  groupId: 'g1',
  subgroupNumber: null,
  itemName: 'История России',
  teacherName: 'Руднева Ксения Андреевна',
  classroom: '31',
  lessonType: 'PRACTICAL',
  ...over,
});

const build = (
  lessons: FormLesson[],
  groups = [
    { id: 'g1', code: 'Ю-25-1', courseNumber: 2, semesterNumber: 3, subgroupCount: 1 },
    { id: 'g2', code: 'Ю-25-2', courseNumber: 2, semesterNumber: 3, subgroupCount: 1 },
  ],
) =>
  buildFormSheet({
    meta: {
      key: 'k',
      specialtyCode: '40.02.04',
      specialtyName: 'Юриспруденция',
      higherEducation: false,
      profile: 'Социально-экономический',
      studyForm: 'FULL_TIME',
      educationBase: 'BASIC_GENERAL',
      academicYear: '2026-2027',
    },
    groups,
    lessons,
    days: ['2026-10-19', '2026-10-20'],
    lessonTimes: [
      { lessonNumber: 1, startTime: '08:30', endTime: '10:00' },
      { lessonNumber: 2, startTime: '10:10', endTime: '11:40' },
      { lessonNumber: 3, startTime: '12:20', endTime: '13:50' },
      { lessonNumber: 4, startTime: '14:00', endTime: '15:30' },
    ],
    showLessonTypes: false,
    weekLabel: '1 неделя',
    organizationName: 'Филиал ДГУ в г. Кизляре',
    settings: DEFAULT_PRINT_FORM,
  });

describe('печатная форма расписания', () => {
  it('объединяет одинаковую пару соседних групп в одну ячейку, разные — оставляет раздельными', () => {
    const sheet = build([
      lesson({ groupId: 'g1' }),
      lesson({ groupId: 'g2' }),
      lesson({ groupId: 'g1', lessonNumber: 2, itemName: 'Физическая культура', classroom: 'Спортзал' }),
      lesson({
        groupId: 'g2',
        lessonNumber: 2,
        itemName: 'Теория государства и права',
        teacherName: 'Магомедов А Т',
      }),
    ]);
    const [first, second] = sheet.days[0].rows;
    expect(first.cells).toEqual([
      { span: 2, subject: 'История России', teacher: 'Руднева К.А.', type: null, room: '31' },
    ]);
    expect(second.cells.map((c) => [c.span, c.subject])).toEqual([
      [1, 'Физическая культура'],
      [1, 'Теория государства и права'],
    ]);
    expect(sheet.header).toEqual([
      [{ text: '2 курс', span: 2 }],
      [{ text: '3 семестр', span: 2 }],
      [
        { text: 'Ю-25-1', span: 1 },
        { text: 'Ю-25-2', span: 1 },
      ],
    ]);
  });

  it('делит группу на подгруппы, пара всей группы занимает обе', () => {
    const sheet = build(
      [
        lesson({}),
        lesson({ lessonNumber: 2, subgroupNumber: 1, itemName: 'Информатика' }),
        lesson({ lessonNumber: 2, subgroupNumber: 2, itemName: 'Иностранный язык' }),
      ],
      [{ id: 'g1', code: 'ИСП-26-1', courseNumber: 1, semesterNumber: 1, subgroupCount: 2 }],
    );
    expect(sheet.columns).toEqual([
      { groupId: 'g1', subgroup: 1 },
      { groupId: 'g1', subgroup: 2 },
    ]);
    expect(sheet.days[0].rows[0].cells).toHaveLength(1);
    expect(sheet.days[0].rows[0].cells[0].span).toBe(2);
    expect(sheet.days[0].rows[1].cells.map((c) => c.subject)).toEqual(['Информатика', 'Иностранный язык']);
  });

  it('показывает строки с первой до последней пары дня, не меньше трёх, и пустые дни', () => {
    const sheet = build([lesson({ lessonNumber: 2 })]);
    expect(sheet.days[0].rows.map((r) => r.lessonNumber)).toEqual([2, 3, 4]);
    expect(sheet.days[0].rows[0].time).toBe('10.10–11.40');
    expect(sheet.days[1].rows).toHaveLength(3);
    expect(sheet.days[1].rows[0].cells.every((c) => c.subject === null)).toBe(true);
  });

  it('собирает заголовок как на бланке', () => {
    const sheet = build([lesson({ lessonNumber: 2 })]);
    expect(sheet.titleLines).toEqual([
      'Расписание занятий',
      'специальности 40.02.04 «Юриспруденция» профиль «Социально-экономический»',
      'Филиал ДГУ в г. Кизляре, на базе основного общего образования',
      '2026-2027 учебный год, форма обучения: очная',
      '1 неделя · Начало занятий в 10.10',
    ]);
    expect(sheet.year).toBe(2026);
  });

  it('сокращает ФИО и нормализует настройки бланка', () => {
    expect(shortTeacherName('Исламова Сабина Хасановна')).toBe('Исламова С.Х.');
    expect(shortTeacherName('Петров')).toBe('Петров');
    const settings = normalizePrintForm({
      approvals: [{ heading: 'УТВЕРЖДАЮ', position: 'И.о. директора', name: 'Абдулаева И.А.', extra: 1 }],
      profiles: { s1: ' Социально-экономический ', s2: '' },
    });
    expect(settings.approvals).toEqual([
      { heading: 'УТВЕРЖДАЮ', position: 'И.о. директора', name: 'Абдулаева И.А.' },
    ]);
    expect(settings.profiles).toEqual({ s1: 'Социально-экономический' });
    expect(settings.footerPosition).toBe('Специалист по учебно-методической работе');
    expect(normalizePrintForm(null)).toEqual(DEFAULT_PRINT_FORM);
  });
});
