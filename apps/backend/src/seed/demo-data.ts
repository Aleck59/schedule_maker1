import { CalendarEventType, ClassroomType, ControlForm, CurriculumItemType } from '@prisma/client';

/** Демо-данные: колледж, специальность 09.02.07, преподаватели, аудитории, учебный план */

export const ORGANIZATION = {
  name: 'Колледж цифровых технологий (демонстрационная организация)',
  shortName: 'КЦТ',
  address: 'г. Энск, ул. Учебная, д. 1',
  timezone: 'Europe/Moscow',
};

export const SPECIALTY = {
  code: '09.02.07',
  name: 'Информационные системы и программирование',
  qualification: 'Программист',
  fgosNumber: '1547',
  fgosDate: '2016-12-09',
  durationMonths: 46,
};

export const DEMO_USERS = {
  admin: { email: 'admin@college.ru', password: 'Admin123!', fullName: 'Администратор системы' },
  dispatcher: { email: 'dispatcher@college.ru', password: 'Dispatcher123!', fullName: 'Орлова Светлана Викторовна' },
  teacher: { email: 'teacher@college.ru', password: 'Teacher123!' },
  student: { email: 'student@college.ru', password: 'Student123!', fullName: 'Студент демонстрационный' },
  manager: { email: 'director@college.ru', password: 'Director123!', fullName: 'Соколов Виктор Андреевич' },
};

export interface TeacherSeed {
  key: string;
  fullName: string;
  department: string;
  position: string;
  email: string;
  maxWeeklyLessons: number;
  maxDailyLessons: number;
  preferredStartLesson: number;
  preferredEndLesson: number;
  /** [день недели, пары] недоступные слоты */
  unavailable: Array<{ weekday: number; lessons: number[]; reason: string }>;
  preferences?: Array<{ weekday: number; lesson: number; weight: number }>;
}

const ALL = [1, 2, 3, 4, 5, 6];

export const TEACHERS: TeacherSeed[] = [
  {
    key: 'ivanova',
    fullName: 'Иванова Мария Петровна',
    department: 'ЦК математических и естественнонаучных дисциплин',
    position: 'Преподаватель высшей категории',
    email: 'ivanova@college.ru',
    maxWeeklyLessons: 18,
    maxDailyLessons: 4,
    preferredStartLesson: 1,
    preferredEndLesson: 4,
    unavailable: [{ weekday: 6, lessons: ALL, reason: 'Не работает по субботам' }],
  },
  {
    key: 'petrov',
    fullName: 'Петров Алексей Сергеевич',
    department: 'ЦК информационных технологий',
    position: 'Преподаватель первой категории',
    email: 'petrov@college.ru',
    maxWeeklyLessons: 24,
    maxDailyLessons: 5,
    preferredStartLesson: 1,
    preferredEndLesson: 5,
    unavailable: [{ weekday: 1, lessons: [1, 2], reason: 'Методическое совещание ЦК' }],
  },
  {
    key: 'sidorova',
    fullName: 'Сидорова Елена Викторовна',
    department: 'ЦК информационных технологий',
    position: 'Преподаватель',
    email: 'sidorova@college.ru',
    maxWeeklyLessons: 20,
    maxDailyLessons: 4,
    preferredStartLesson: 1,
    preferredEndLesson: 5,
    unavailable: [{ weekday: 3, lessons: ALL, reason: 'Методический день' }],
  },
  {
    key: 'kuznetsov',
    fullName: 'Кузнецов Дмитрий Игоревич',
    department: 'ЦК информационных технологий',
    position: 'Преподаватель (внешний совместитель)',
    email: 'kuznetsov@college.ru',
    maxWeeklyLessons: 14,
    maxDailyLessons: 4,
    preferredStartLesson: 3,
    preferredEndLesson: 6,
    unavailable: [
      { weekday: 1, lessons: ALL, reason: 'Основное место работы' },
      { weekday: 2, lessons: [1, 2], reason: 'Основное место работы' },
      { weekday: 3, lessons: [1, 2], reason: 'Основное место работы' },
      { weekday: 4, lessons: [1, 2], reason: 'Основное место работы' },
      { weekday: 5, lessons: [1, 2], reason: 'Основное место работы' },
      { weekday: 6, lessons: ALL, reason: 'Основное место работы' },
    ],
  },
  {
    key: 'smirnova',
    fullName: 'Смирнова Ольга Николаевна',
    department: 'ЦК гуманитарных и социально-экономических дисциплин',
    position: 'Преподаватель иностранного языка',
    email: 'smirnova@college.ru',
    maxWeeklyLessons: 18,
    maxDailyLessons: 4,
    preferredStartLesson: 1,
    preferredEndLesson: 5,
    unavailable: [{ weekday: 4, lessons: ALL, reason: 'Методический день' }],
  },
  {
    key: 'volkova',
    fullName: 'Волкова Анна Андреевна',
    department: 'ЦК гуманитарных и социально-экономических дисциплин',
    position: 'Преподаватель иностранного языка',
    email: 'volkova@college.ru',
    maxWeeklyLessons: 18,
    maxDailyLessons: 4,
    preferredStartLesson: 1,
    preferredEndLesson: 4,
    unavailable: [{ weekday: 5, lessons: [4, 5, 6], reason: 'Занятия в другом отделении' }],
  },
  {
    key: 'morozov',
    fullName: 'Морозов Игорь Владимирович',
    department: 'ЦК физического воспитания',
    position: 'Руководитель физического воспитания',
    email: 'morozov@college.ru',
    maxWeeklyLessons: 24,
    maxDailyLessons: 5,
    preferredStartLesson: 2,
    preferredEndLesson: 5,
    unavailable: [],
    preferences: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, lesson: 1, weight: -3 })),
  },
  {
    key: 'novikova',
    fullName: 'Новикова Татьяна Сергеевна',
    department: 'ЦК информационных технологий',
    position: 'Преподаватель высшей категории',
    email: 'novikova@college.ru',
    maxWeeklyLessons: 20,
    maxDailyLessons: 4,
    preferredStartLesson: 1,
    preferredEndLesson: 5,
    unavailable: [{ weekday: 6, lessons: ALL, reason: 'Не работает по субботам' }],
  },
  {
    key: 'lebedev',
    fullName: 'Лебедев Павел Олегович',
    department: 'ЦК общепрофессиональных дисциплин',
    position: 'Преподаватель',
    email: 'lebedev@college.ru',
    maxWeeklyLessons: 16,
    maxDailyLessons: 4,
    preferredStartLesson: 1,
    preferredEndLesson: 5,
    unavailable: [{ weekday: 2, lessons: ALL, reason: 'Работа в приёмной комиссии' }],
  },
];

export interface ClassroomSeed {
  code: string;
  name: string;
  building: string;
  floor: number;
  capacity: number;
  classroomType: ClassroomType;
  equipment: Record<string, unknown>;
  unavailable?: Array<{ weekday: number; lessons: number[]; reason: string }>;
}

const MAIN = 'Главный корпус';
const SECOND = 'Учебный корпус №2';

export const CLASSROOMS: ClassroomSeed[] = [
  { code: 'А-101', name: 'Лекционная аудитория №1', building: MAIN, floor: 1, capacity: 60, classroomType: 'LECTURE', equipment: { projector: true, microphone: true }, unavailable: [{ weekday: 6, lessons: [4, 5, 6], reason: 'Общеколледжные мероприятия' }] },
  { code: 'А-102', name: 'Лекционная аудитория №2', building: MAIN, floor: 1, capacity: 40, classroomType: 'LECTURE', equipment: { projector: true } },
  { code: 'А-201', name: 'Кабинет математики', building: MAIN, floor: 2, capacity: 32, classroomType: 'GENERAL', equipment: { interactiveBoard: true } },
  { code: 'А-202', name: 'Кабинет иностранного языка №1', building: MAIN, floor: 2, capacity: 16, classroomType: 'GENERAL', equipment: { audio: true } },
  { code: 'А-203', name: 'Кабинет иностранного языка №2', building: MAIN, floor: 2, capacity: 16, classroomType: 'GENERAL', equipment: { audio: true } },
  { code: 'А-204', name: 'Кабинет гуманитарных дисциплин', building: MAIN, floor: 2, capacity: 30, classroomType: 'GENERAL', equipment: { projector: true } },
  { code: 'А-205', name: 'Кабинет правовых дисциплин и БЖД', building: MAIN, floor: 2, capacity: 30, classroomType: 'GENERAL', equipment: { projector: true, simulators: true } },
  { code: 'А-301', name: 'Компьютерный класс №1', building: MAIN, floor: 3, capacity: 26, classroomType: 'COMPUTER_LAB', equipment: { computers: 26, projector: true } },
  { code: 'А-302', name: 'Компьютерный класс №2', building: MAIN, floor: 3, capacity: 26, classroomType: 'COMPUTER_LAB', equipment: { computers: 26 } },
  { code: 'А-303', name: 'Компьютерный класс №3 (для подгрупп)', building: MAIN, floor: 3, capacity: 15, classroomType: 'COMPUTER_LAB', equipment: { computers: 15 } },
  { code: 'Б-101', name: 'Лаборатория компьютерных сетей', building: SECOND, floor: 1, capacity: 26, classroomType: 'LABORATORY', equipment: { computers: 26, networkRacks: 4 } },
  { code: 'Б-102', name: 'Мастерская по обслуживанию средств вычислительной техники', building: SECOND, floor: 1, capacity: 15, classroomType: 'WORKSHOP', equipment: { workbenches: 15 } },
  { code: 'Б-001', name: 'Спортивный зал', building: SECOND, floor: 0, capacity: 60, classroomType: 'SPORTS_HALL', equipment: { lockers: true }, unavailable: [{ weekday: 3, lessons: [5, 6], reason: 'Спортивные секции' }] },
  { code: 'ЭИОС', name: 'Дистанционно (электронная образовательная среда)', building: 'Онлайн', floor: 0, capacity: 500, classroomType: 'ONLINE', equipment: { platform: 'ЭИОС колледжа' } },
];

export interface SemesterHoursSeed {
  semester: number;
  lecture?: number;
  practical?: number;
  laboratory?: number;
  consultation?: number;
  selfStudy?: number;
  assessment?: number;
  practice?: number;
  total?: number;
  control: ControlForm;
  practiceAtCollege?: boolean;
  lectureRoomTypes?: ClassroomType[];
  practicalRoomTypes?: ClassroomType[];
  laboratoryRoomTypes?: ClassroomType[];
  practiceRoomTypes?: ClassroomType[];
}

export interface AssignmentSeed {
  /** null — все виды занятий */
  lessonType?: 'LECTURE' | 'PRACTICAL' | 'LABORATORY' | 'CONSULTATION' | 'PRACTICE' | null;
  subgroup?: number | null;
  teacher: string;
  weeklyLessonTarget?: number;
}

export interface ItemSeed {
  cycle: string;
  code: string;
  name: string;
  itemType: CurriculumItemType;
  parent?: string;
  isDifficult?: boolean;
  /** Отмечено в ТЗ как обязательная демо-дисциплина */
  fromSpec?: boolean;
  semesters: SemesterHoursSeed[];
  assignments?: AssignmentSeed[];
}

export const CYCLES = [
  { code: 'ОГСЭ', name: 'Общий гуманитарный и социально-экономический цикл', sortOrder: 1 },
  { code: 'ЕН', name: 'Математический и общий естественнонаучный цикл', sortOrder: 2 },
  { code: 'ОП', name: 'Общепрофессиональный цикл', sortOrder: 3 },
  { code: 'П.ПМ', name: 'Профессиональный цикл (профессиональные модули)', sortOrder: 4 },
  { code: 'ГИА', name: 'Государственная итоговая аттестация', sortOrder: 5 },
];

export const CURRICULUM: ItemSeed[] = [
  {
    cycle: 'ОГСЭ',
    code: 'ОГСЭ.03',
    name: 'Иностранный язык в профессиональной деятельности',
    itemType: 'DISCIPLINE',
    semesters: [
      { semester: 3, practical: 32, control: 'OTHER', practicalRoomTypes: ['GENERAL'] },
      { semester: 4, practical: 36, control: 'DIFFERENTIATED_CREDIT', practicalRoomTypes: ['GENERAL'] },
    ],
    assignments: [
      { lessonType: 'PRACTICAL', subgroup: 1, teacher: 'smirnova' },
      { lessonType: 'PRACTICAL', subgroup: 2, teacher: 'volkova' },
    ],
  },
  {
    cycle: 'ОГСЭ',
    code: 'ОГСЭ.04',
    name: 'Физическая культура',
    itemType: 'DISCIPLINE',
    semesters: [
      { semester: 3, practical: 32, control: 'CREDIT', practicalRoomTypes: ['SPORTS_HALL'] },
      { semester: 4, practical: 36, control: 'DIFFERENTIATED_CREDIT', practicalRoomTypes: ['SPORTS_HALL'] },
    ],
    assignments: [{ teacher: 'morozov' }],
  },
  {
    cycle: 'ЕН',
    code: 'ЕН.01',
    name: 'Элементы высшей математики',
    itemType: 'DISCIPLINE',
    isDifficult: true,
    fromSpec: true,
    semesters: [{ semester: 3, lecture: 36, practical: 34, selfStudy: 29, control: 'EXAM', practicalRoomTypes: ['GENERAL', 'LECTURE'] }],
    assignments: [{ teacher: 'ivanova' }],
  },
  {
    cycle: 'ЕН',
    code: 'ЕН.02',
    name: 'Дискретная математика с элементами математической логики',
    itemType: 'DISCIPLINE',
    isDifficult: true,
    semesters: [{ semester: 3, lecture: 24, practical: 24, selfStudy: 6, control: 'DIFFERENTIATED_CREDIT' }],
    assignments: [{ teacher: 'ivanova' }],
  },
  {
    cycle: 'ЕН',
    code: 'ЕН.03',
    name: 'Теория вероятностей и математическая статистика',
    itemType: 'DISCIPLINE',
    semesters: [{ semester: 4, lecture: 24, practical: 22, selfStudy: 4, control: 'DIFFERENTIATED_CREDIT' }],
    assignments: [{ teacher: 'ivanova' }],
  },
  {
    cycle: 'ОП',
    code: 'ОП.01',
    name: 'Операционные системы и среды',
    itemType: 'DISCIPLINE',
    fromSpec: true,
    semesters: [
      {
        semester: 4,
        lecture: 20,
        practical: 40,
        consultation: 1,
        selfStudy: 2,
        control: 'EXAM',
        practicalRoomTypes: ['COMPUTER_LAB'],
      },
    ],
    assignments: [{ teacher: 'sidorova' }],
  },
  {
    cycle: 'ОП',
    code: 'ОП.02',
    name: 'Архитектура аппаратных средств',
    itemType: 'DISCIPLINE',
    semesters: [
      { semester: 3, lecture: 26, practical: 20, selfStudy: 4, control: 'DIFFERENTIATED_CREDIT', practicalRoomTypes: ['LABORATORY', 'COMPUTER_LAB'] },
    ],
    assignments: [{ teacher: 'kuznetsov' }],
  },
  {
    cycle: 'ОП',
    code: 'ОП.03',
    name: 'Информационные технологии',
    itemType: 'DISCIPLINE',
    semesters: [
      { semester: 3, lecture: 20, laboratory: 30, selfStudy: 4, control: 'DIFFERENTIATED_CREDIT', laboratoryRoomTypes: ['COMPUTER_LAB'] },
    ],
    assignments: [
      { lessonType: 'LECTURE', teacher: 'sidorova' },
      { lessonType: 'LABORATORY', subgroup: 1, teacher: 'sidorova' },
      { lessonType: 'LABORATORY', subgroup: 2, teacher: 'novikova' },
    ],
  },
  {
    cycle: 'ОП',
    code: 'ОП.04',
    name: 'Основы алгоритмизации и программирования',
    itemType: 'DISCIPLINE',
    isDifficult: true,
    fromSpec: true,
    semesters: [{ semester: 3, lecture: 34, practical: 34, selfStudy: 4, control: 'OTHER', practicalRoomTypes: ['COMPUTER_LAB'] }],
    // «Занятия проводить 2 раза в неделю, если возможно»
    assignments: [{ teacher: 'petrov', weeklyLessonTarget: 2 }],
  },
  {
    cycle: 'ОП',
    code: 'ОП.05',
    name: 'Правовое обеспечение профессиональной деятельности',
    itemType: 'DISCIPLINE',
    semesters: [{ semester: 4, lecture: 22, practical: 10, control: 'DIFFERENTIATED_CREDIT' }],
    assignments: [{ teacher: 'lebedev' }],
  },
  {
    cycle: 'ОП',
    code: 'ОП.06',
    name: 'Безопасность жизнедеятельности',
    itemType: 'DISCIPLINE',
    semesters: [{ semester: 4, lecture: 36, practical: 32, control: 'DIFFERENTIATED_CREDIT', practicalRoomTypes: ['GENERAL'] }],
    assignments: [{ teacher: 'lebedev' }],
  },
  {
    cycle: 'ОП',
    code: 'ОП.08',
    name: 'Основы проектирования баз данных',
    itemType: 'DISCIPLINE',
    semesters: [
      { semester: 3, lecture: 30, laboratory: 24, selfStudy: 4, control: 'EXAM', laboratoryRoomTypes: ['COMPUTER_LAB'] },
    ],
    assignments: [
      { lessonType: 'LECTURE', teacher: 'novikova' },
      { lessonType: 'LABORATORY', subgroup: 1, teacher: 'novikova' },
      { lessonType: 'LABORATORY', subgroup: 2, teacher: 'petrov' },
    ],
  },
  {
    cycle: 'ОП',
    code: 'ОП.11',
    name: 'Компьютерные сети',
    itemType: 'DISCIPLINE',
    fromSpec: true,
    semesters: [
      {
        semester: 4,
        lecture: 30,
        practical: 32,
        consultation: 1,
        selfStudy: 9,
        control: 'EXAM',
        practicalRoomTypes: ['LABORATORY', 'COMPUTER_LAB'],
      },
    ],
    assignments: [{ teacher: 'kuznetsov' }],
  },
  {
    cycle: 'П.ПМ',
    code: 'ПМ.01',
    name: 'Разработка модулей программного обеспечения для компьютерных систем',
    itemType: 'MODULE',
    semesters: [],
  },
  {
    cycle: 'П.ПМ',
    code: 'МДК.01.01',
    name: 'Разработка программных модулей',
    itemType: 'INTERDISCIPLINARY_COURSE',
    parent: 'ПМ.01',
    isDifficult: true,
    semesters: [{ semester: 4, lecture: 40, laboratory: 50, selfStudy: 6, control: 'OTHER', laboratoryRoomTypes: ['COMPUTER_LAB'] }],
    assignments: [
      { lessonType: 'LECTURE', teacher: 'petrov' },
      { lessonType: 'LABORATORY', subgroup: 1, teacher: 'petrov' },
      { lessonType: 'LABORATORY', subgroup: 2, teacher: 'novikova' },
    ],
  },
  {
    cycle: 'П.ПМ',
    code: 'УП.01',
    name: 'Учебная практика',
    itemType: 'EDUCATIONAL_PRACTICE',
    parent: 'ПМ.01',
    semesters: [
      { semester: 4, practice: 72, control: 'DIFFERENTIATED_CREDIT', practiceAtCollege: true, practiceRoomTypes: ['COMPUTER_LAB'] },
    ],
    assignments: [{ teacher: 'petrov' }],
  },
  {
    cycle: 'П.ПМ',
    code: 'ПП.01',
    name: 'Производственная практика',
    itemType: 'INDUSTRIAL_PRACTICE',
    parent: 'ПМ.01',
    semesters: [{ semester: 5, total: 144, control: 'DIFFERENTIATED_CREDIT' }],
  },
  {
    cycle: 'П.ПМ',
    code: 'ПМ.09',
    name: 'Проектирование, разработка и оптимизация веб-приложений',
    itemType: 'MODULE',
    semesters: [],
  },
  {
    cycle: 'П.ПМ',
    code: 'МДК.09.01',
    name: 'Веб-программирование',
    itemType: 'INTERDISCIPLINARY_COURSE',
    parent: 'ПМ.09',
    fromSpec: true,
    semesters: [
      {
        semester: 7,
        lecture: 32,
        practical: 32,
        consultation: 1,
        selfStudy: 34,
        control: 'EXAM',
        practicalRoomTypes: ['COMPUTER_LAB'],
      },
    ],
    assignments: [{ teacher: 'petrov' }],
  },
  {
    cycle: 'П.ПМ',
    code: 'ПДП',
    name: 'Преддипломная практика',
    itemType: 'PRE_DIPLOMA_PRACTICE',
    semesters: [{ semester: 8, total: 144, control: 'DIFFERENTIATED_CREDIT' }],
  },
  {
    cycle: 'ГИА',
    code: 'ГИА.01',
    name: 'Государственная итоговая аттестация (демонстрационный экзамен, защита дипломного проекта)',
    itemType: 'FINAL_ATTESTATION',
    semesters: [{ semester: 8, total: 216, control: 'NONE' }],
  },
];

/** Календарная структура семестра относительно года набора */
export interface SemesterPlan {
  number: number;
  course: number;
  /** Смещение года относительно года набора */
  yearOffset: number;
  start: string; // MM-DD
  end: string;
  periods: Array<{ type: CalendarEventType; start: string; end: string; title: string; yearShift?: number }>;
  theoreticalWeeks: number;
  examWeeks: number;
  vacationWeeks: number;
  practiceWeeks: number;
}

export const HOLIDAY_FIXED = [
  { md: '02-23', title: 'День защитника Отечества' },
  { md: '03-08', title: 'Международный женский день' },
  { md: '05-01', title: 'Праздник Весны и Труда' },
  { md: '05-09', title: 'День Победы' },
  { md: '06-12', title: 'День России' },
  { md: '11-04', title: 'День народного единства' },
];

/** Перенесённые выходные (производственный календарь) */
export const HOLIDAY_TRANSFERS: Record<number, Array<{ date: string; title: string }>> = {
  2025: [
    { date: '2025-02-24', title: 'Перенос выходного (23 февраля)' },
    { date: '2025-03-10', title: 'Перенос выходного (8 марта)' },
    { date: '2025-05-02', title: 'Перенос выходного' },
    { date: '2025-05-08', title: 'Перенос выходного' },
    { date: '2025-06-13', title: 'Перенос выходного' },
    { date: '2025-11-03', title: 'Перенос выходного' },
  ],
  2026: [
    { date: '2026-03-09', title: 'Перенос выходного (8 марта)' },
    { date: '2026-05-11', title: 'Перенос выходного (9 мая)' },
  ],
  2027: [
    { date: '2027-05-03', title: 'Перенос выходного (1 мая)' },
    { date: '2027-05-10', title: 'Перенос выходного (9 мая)' },
    { date: '2027-06-14', title: 'Перенос выходного (12 июня)' },
  ],
};

/** Структура 8 семестров: теоретическое обучение, практики, сессии, каникулы */
export function semesterPlans(): SemesterPlan[] {
  return [
    {
      number: 1, course: 1, yearOffset: 0, start: '09-01', end: '12-31',
      theoreticalWeeks: 16, examWeeks: 1, vacationWeeks: 2, practiceWeeks: 0,
      periods: [
        { type: 'THEORETICAL_TRAINING', start: '09-01', end: '12-21', title: 'Теоретическое обучение' },
        { type: 'EXAM_SESSION', start: '12-22', end: '12-30', title: 'Промежуточная аттестация' },
        { type: 'VACATION', start: '12-31', end: '01-11', title: 'Зимние каникулы', yearShift: 1 },
      ],
    },
    {
      number: 2, course: 1, yearOffset: 1, start: '01-12', end: '06-30',
      theoreticalWeeks: 21, examWeeks: 2, vacationWeeks: 9, practiceWeeks: 0,
      periods: [
        { type: 'THEORETICAL_TRAINING', start: '01-12', end: '06-07', title: 'Теоретическое обучение' },
        { type: 'EXAM_SESSION', start: '06-08', end: '06-28', title: 'Промежуточная аттестация' },
        { type: 'VACATION', start: '06-29', end: '08-31', title: 'Летние каникулы' },
      ],
    },
    {
      number: 3, course: 2, yearOffset: 1, start: '09-01', end: '12-31',
      theoreticalWeeks: 16, examWeeks: 1, vacationWeeks: 2, practiceWeeks: 0,
      periods: [
        { type: 'THEORETICAL_TRAINING', start: '09-01', end: '12-21', title: 'Теоретическое обучение' },
        { type: 'EXAM_SESSION', start: '12-22', end: '12-30', title: 'Промежуточная аттестация' },
        { type: 'VACATION', start: '12-31', end: '01-11', title: 'Зимние каникулы', yearShift: 1 },
      ],
    },
    {
      number: 4, course: 2, yearOffset: 2, start: '01-12', end: '06-30',
      theoreticalWeeks: 20, examWeeks: 2, vacationWeeks: 9, practiceWeeks: 2,
      periods: [
        { type: 'THEORETICAL_TRAINING', start: '01-12', end: '05-31', title: 'Теоретическое обучение' },
        { type: 'EDUCATIONAL_PRACTICE', start: '06-01', end: '06-14', title: 'Учебная практика УП.01 (на базе колледжа)' },
        { type: 'EXAM_SESSION', start: '06-15', end: '06-28', title: 'Промежуточная аттестация' },
        { type: 'VACATION', start: '06-29', end: '08-31', title: 'Летние каникулы' },
      ],
    },
    {
      number: 5, course: 3, yearOffset: 2, start: '09-01', end: '12-31',
      theoreticalWeeks: 12, examWeeks: 1, vacationWeeks: 2, practiceWeeks: 4,
      periods: [
        { type: 'THEORETICAL_TRAINING', start: '09-01', end: '11-22', title: 'Теоретическое обучение' },
        { type: 'INDUSTRIAL_PRACTICE', start: '11-23', end: '12-20', title: 'Производственная практика ПП.01 (на предприятиях)' },
        { type: 'EXAM_SESSION', start: '12-21', end: '12-30', title: 'Промежуточная аттестация' },
        { type: 'VACATION', start: '12-31', end: '01-10', title: 'Зимние каникулы', yearShift: 1 },
      ],
    },
    {
      number: 6, course: 3, yearOffset: 3, start: '01-11', end: '06-30',
      theoreticalWeeks: 21, examWeeks: 2, vacationWeeks: 9, practiceWeeks: 0,
      periods: [
        { type: 'THEORETICAL_TRAINING', start: '01-11', end: '06-06', title: 'Теоретическое обучение' },
        { type: 'EXAM_SESSION', start: '06-07', end: '06-27', title: 'Промежуточная аттестация' },
        { type: 'VACATION', start: '06-28', end: '08-31', title: 'Летние каникулы' },
      ],
    },
    {
      number: 7, course: 4, yearOffset: 3, start: '09-01', end: '12-31',
      theoreticalWeeks: 16, examWeeks: 1, vacationWeeks: 2, practiceWeeks: 0,
      periods: [
        { type: 'THEORETICAL_TRAINING', start: '09-01', end: '12-19', title: 'Теоретическое обучение' },
        { type: 'EXAM_SESSION', start: '12-20', end: '12-30', title: 'Промежуточная аттестация' },
        { type: 'VACATION', start: '12-31', end: '01-09', title: 'Зимние каникулы', yearShift: 1 },
      ],
    },
    {
      number: 8, course: 4, yearOffset: 4, start: '01-10', end: '06-30',
      theoreticalWeeks: 10, examWeeks: 1, vacationWeeks: 0, practiceWeeks: 4,
      periods: [
        { type: 'THEORETICAL_TRAINING', start: '01-10', end: '03-19', title: 'Теоретическое обучение' },
        { type: 'EXAM_SESSION', start: '03-20', end: '03-26', title: 'Промежуточная аттестация' },
        { type: 'PRE_DIPLOMA_PRACTICE', start: '03-27', end: '04-23', title: 'Преддипломная практика' },
        { type: 'DEMO_EXAM_PREPARATION', start: '04-24', end: '05-01', title: 'Подготовка к демонстрационному экзамену' },
        { type: 'DEMO_EXAM', start: '05-02', end: '05-14', title: 'Демонстрационный экзамен' },
        { type: 'DIPLOMA_PREPARATION', start: '05-15', end: '06-11', title: 'Подготовка дипломного проекта' },
        { type: 'DIPLOMA_DEFENSE', start: '06-12', end: '06-30', title: 'Защита дипломного проекта' },
        { type: 'FINAL_ATTESTATION', start: '05-02', end: '06-30', title: 'Государственная итоговая аттестация' },
      ],
    },
  ];
}

// --- Имена студентов (генерация детерминированная)
export const MALE_LAST = ['Иванов', 'Смирнов', 'Кузьмин', 'Попов', 'Васильев', 'Соколов', 'Михайлов', 'Фёдоров', 'Алексеев', 'Семёнов', 'Егоров', 'Павлов', 'Козлов', 'Степанов', 'Николаев', 'Андреев', 'Макаров', 'Никитин', 'Захаров', 'Зайцев', 'Борисов', 'Королёв', 'Гусев', 'Титов', 'Белов'];
export const MALE_FIRST = ['Александр', 'Дмитрий', 'Максим', 'Сергей', 'Андрей', 'Алексей', 'Артём', 'Илья', 'Кирилл', 'Михаил', 'Никита', 'Матвей', 'Роман', 'Егор', 'Арсений', 'Иван', 'Денис', 'Тимофей'];
export const FEMALE_FIRST = ['Анастасия', 'Мария', 'Анна', 'Виктория', 'Екатерина', 'Наталья', 'Марина', 'Полина', 'Дарья', 'Алина', 'Ксения', 'Елизавета', 'Софья', 'Вероника'];
export const PATRONYMIC_BASE = ['Александров', 'Дмитриев', 'Сергеев', 'Андреев', 'Алексеев', 'Игорев', 'Олегов', 'Викторов', 'Николаев', 'Михайлов'];
