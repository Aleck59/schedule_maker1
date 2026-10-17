import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';

/** Русские названия полей DTO для сообщений об ошибках */
const FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  password: 'Пароль',
  fullName: 'ФИО',
  role: 'Роль',
  name: 'Наименование',
  title: 'Название',
  code: 'Код',
  shortName: 'Краткое наименование',
  qualification: 'Квалификация',
  durationMonths: 'Срок обучения (мес.)',
  admissionYear: 'Год набора',
  totalSemesters: 'Количество семестров',
  studyForm: 'Форма обучения',
  status: 'Статус',
  startDate: 'Дата начала',
  endDate: 'Дата окончания',
  date: 'Дата',
  number: 'Номер',
  courseNumber: 'Курс',
  studentCount: 'Количество студентов',
  subgroupCount: 'Количество подгрупп',
  subgroupNumber: 'Подгруппа',
  capacity: 'Вместимость',
  classroomType: 'Тип аудитории',
  weekday: 'День недели',
  lessonNumber: 'Номер пары',
  lessonType: 'Вид занятия',
  teacherId: 'Преподаватель',
  classroomId: 'Аудитория',
  studentGroupId: 'Группа',
  semesterId: 'Семестр',
  semesterCurriculumItemId: 'Дисциплина',
  schedulePeriodId: 'Период расписания',
  academicYearId: 'Учебный год',
  eventType: 'Тип периода',
  maxWeeklyLessons: 'Макс. пар в неделю',
  maxDailyLessons: 'Макс. пар в день',
  actualHours: 'Фактические часы',
  academicHours: 'Академические часы',
  reason: 'Причина',
  refreshToken: 'Токен обновления',
  substituteTeacherId: 'Заменяющий преподаватель',
};

function fieldLabel(property: string): string {
  return FIELD_LABELS[property] ?? property;
}

function translateConstraint(constraint: string, original: string): string {
  const num = /(-?\d+(?:\.\d+)?)/.exec(original)?.[1];
  switch (constraint) {
    case 'isNotEmpty':
    case 'isDefined':
      return 'обязательно для заполнения';
    case 'isEmail':
      return 'должно быть корректным адресом электронной почты';
    case 'isString':
      return 'должно быть строкой';
    case 'isInt':
      return 'должно быть целым числом';
    case 'isNumber':
      return 'должно быть числом';
    case 'isBoolean':
      return 'должно быть логическим значением';
    case 'isEnum':
    case 'isIn':
      return 'содержит недопустимое значение';
    case 'isUUID':
      return 'должно быть корректным идентификатором';
    case 'isDateString':
    case 'isISO8601':
    case 'matches':
      return original.includes('YYYY') ? original : 'имеет неверный формат';
    case 'isArray':
      return 'должно быть списком';
    case 'arrayNotEmpty':
    case 'arrayMinSize':
      return 'должно содержать хотя бы одно значение';
    case 'min':
      return `должно быть не меньше ${num ?? ''}`.trim();
    case 'max':
      return `должно быть не больше ${num ?? ''}`.trim();
    case 'minLength':
      return `должно содержать не менее ${num ?? ''} символов`.trim();
    case 'maxLength':
      return `должно содержать не более ${num ?? ''} символов`.trim();
    case 'whitelistValidation':
      return 'не поддерживается';
    case 'isObject':
      return 'должно быть объектом';
    default:
      return 'имеет недопустимое значение';
  }
}

function flatten(errors: ValidationError[], prefix = ''): string[] {
  const result: string[] = [];
  for (const error of errors) {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    if (error.constraints) {
      for (const [constraint, original] of Object.entries(error.constraints)) {
        // Сообщения, заданные в DTO на русском, используем как есть
        if (/[а-яё]/i.test(original)) {
          result.push(original);
        } else {
          result.push(`Поле «${fieldLabel(error.property)}» ${translateConstraint(constraint, original)}`);
        }
      }
    }
    if (error.children?.length) {
      result.push(...flatten(error.children, path));
    }
  }
  return result;
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: (errors: ValidationError[]) => {
      const messages = flatten(errors);
      return new BadRequestException({
        message: messages[0] ?? 'Ошибка валидации данных',
        errors: messages,
      });
    },
  });
}
