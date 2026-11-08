import { ClassroomType, LessonType } from '@prisma/client';

/** Типы аудиторий по умолчанию для вида занятия */
export function defaultRoomTypes(lessonType: LessonType): ClassroomType[] {
  switch (lessonType) {
    case LessonType.LECTURE:
      return [ClassroomType.LECTURE, ClassroomType.GENERAL];
    case LessonType.PRACTICAL:
      return [ClassroomType.GENERAL, ClassroomType.LECTURE];
    case LessonType.LABORATORY:
      return [ClassroomType.LABORATORY, ClassroomType.COMPUTER_LAB];
    case LessonType.CONSULTATION:
      return [ClassroomType.GENERAL, ClassroomType.LECTURE];
    case LessonType.PRACTICE:
      return [ClassroomType.WORKSHOP, ClassroomType.COMPUTER_LAB, ClassroomType.LABORATORY];
    default:
      return [ClassroomType.GENERAL, ClassroomType.LECTURE];
  }
}

export interface RoomTypeSource {
  lectureRoomTypes: ClassroomType[];
  practicalRoomTypes: ClassroomType[];
  laboratoryRoomTypes: ClassroomType[];
  consultationRoomTypes: ClassroomType[];
  practiceRoomTypes: ClassroomType[];
}

/** Допустимые типы аудиторий: назначение → строка плана → значения по умолчанию */
export function effectiveRoomTypes(
  lessonType: LessonType,
  item: RoomTypeSource | null | undefined,
  assignmentOverride?: ClassroomType[] | null,
): ClassroomType[] {
  if (assignmentOverride && assignmentOverride.length > 0) return assignmentOverride;
  if (item) {
    const fromItem =
      lessonType === LessonType.LECTURE
        ? item.lectureRoomTypes
        : lessonType === LessonType.PRACTICAL
          ? item.practicalRoomTypes
          : lessonType === LessonType.LABORATORY
            ? item.laboratoryRoomTypes
            : lessonType === LessonType.CONSULTATION
              ? item.consultationRoomTypes
              : lessonType === LessonType.PRACTICE
                ? item.practiceRoomTypes
                : [];
    if (fromItem && fromItem.length > 0) return fromItem;
  }
  return defaultRoomTypes(lessonType);
}

/**
 * Тип аудитории — предпочтение, а не жёсткая привязка.
 * Если подходящих по типу кабинетов нет или они заняты, занятие можно провести
 * в любом другом учебном кабинете нужной вместимости (кроме онлайн-аудитории и
 * спортзала — спортзал только для занятий, которым он нужен).
 */
export function isFallbackRoomType(type: ClassroomType, preferred: ClassroomType[]): boolean {
  if (preferred.includes(type)) return false;
  return type !== ClassroomType.ONLINE && type !== ClassroomType.SPORTS_HALL;
}

export interface RankableRoom {
  id: string;
  code: string;
  classroomType: ClassroomType;
  capacity: number;
}

// ---------------------------------------------------------------- метки аудиторий

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9.]+/g, ' ')
    .trim();
}

/** Сокращения в метках: «физра» и «физкультура» — физическая культура, «англ» — английский и т. п. */
const TAG_SYNONYMS: Array<[RegExp, string]> = [
  [/^(физра|физкультура|физ-ра|фк)$/, 'физическая культура'],
  [/^(ин яз|иняз|иностранный)$/, 'иностранный'],
  [/^англ$/, 'английский'],
  [/^нем$/, 'немецкий'],
  [/^инф$/, 'информатика'],
  [/^бжд$/, 'безопасность жизнедеятельности'],
  [/^обж$/, 'основы безопасности'],
];

/** Основа слова для сравнения без окончаний: «право» → «прав», «английский» → «английск» */
function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.length <= 5) return word.slice(0, word.length - 1);
  return word.slice(0, word.length - 2);
}

/** Метка похожа на код дисциплины (ОП.01, МДК.02.01, ПМ.03, ОГСЭ.03) */
function isCodeTag(tag: string): boolean {
  return /[0-9]/.test(tag) || /^(оуд|оп|огсэ|ен|мдк|пм|уп|пп|сгц|оод|оо|пд)[.]?$/.test(tag);
}

/**
 * Подходит ли метка аудитории к дисциплине. Код (ОП.01, МДК.01) сравнивается с началом кода
 * дисциплины, слова — с началом слов названия без окончаний: «право» подходит к «Правовое
 * обеспечение…» и «Гражданское право», «Иностранный язык» — к «Иностранный язык в профессиональной
 * деятельности».
 */
export function tagMatches(tag: string, itemName: string, itemCode = ''): boolean {
  let t = normalize(tag);
  if (!t) return false;
  if (isCodeTag(t)) {
    const code = normalize(itemCode).replace(/\s+/g, '');
    const want = t.replace(/\s+/g, '');
    return !!code && code.startsWith(want);
  }
  for (const [re, full] of TAG_SYNONYMS) if (re.test(t)) t = full;
  const words = normalize(itemName).split(' ').filter(Boolean);
  const tagWords = t.split(' ').filter((w) => w.length >= 2 && !/^[0-9.]+$/.test(w));
  if (tagWords.length === 0) return false;
  return tagWords.every((tw) => {
    const st = stem(tw);
    return words.some((w) => w.startsWith(st));
  });
}

export interface TaggedRoom {
  classroomType: ClassroomType;
  tags?: string[] | null;
}

/** Метки аудитории; у спортзала без меток — «физическая культура» */
export function roomTags(room: TaggedRoom): string[] {
  const tags = (room.tags ?? []).filter((t) => t.trim().length > 0);
  if (tags.length === 0 && room.classroomType === ClassroomType.SPORTS_HALL) return ['физическая культура'];
  return tags;
}

/** Аудитории, метки которых подходят к дисциплине */
export function roomsForDiscipline<R extends TaggedRoom & { id: string }>(
  rooms: R[],
  itemName: string,
  itemCode = '',
): R[] {
  return rooms.filter((r) => roomTags(r).some((t) => tagMatches(t, itemName, itemCode)));
}

/**
 * Аудитории в порядке предпочтения: предпочтительная из нагрузки, аудитории с подходящими метками,
 * затем нужного типа (в порядке типов), затем остальные учебные кабинеты. `matching` — сколько
 * первых аудиторий подходят (предпочтительная и по меткам — независимо от типа и вместимости меток).
 */
export function rankRooms<R extends RankableRoom>(
  rooms: R[],
  types: ClassroomType[],
  size: number,
  preferredId: string | null = null,
  taggedIds: ReadonlySet<string> | null = null,
): { rooms: R[]; matching: number } {
  const fits = (r: R) => r.classroomType === ClassroomType.ONLINE || r.capacity >= size;
  const fitSort = (a: R, b: R) => a.capacity - b.capacity || a.code.localeCompare(b.code);
  const preferred = preferredId ? rooms.find((r) => r.id === preferredId) : undefined;
  const taken = new Set<string>(preferred ? [preferred.id] : []);
  const tagged = taggedIds
    ? rooms.filter((r) => taggedIds.has(r.id) && !taken.has(r.id) && fits(r)).sort(fitSort)
    : [];
  for (const r of tagged) taken.add(r.id);
  const matching = rooms
    .filter((r) => !taken.has(r.id) && types.includes(r.classroomType) && fits(r))
    .sort((a, b) => types.indexOf(a.classroomType) - types.indexOf(b.classroomType) || fitSort(a, b));
  const fallback = rooms
    .filter((r) => !taken.has(r.id) && isFallbackRoomType(r.classroomType, types) && fits(r))
    .sort(fitSort);
  const head = [...(preferred ? [preferred] : []), ...tagged, ...matching];
  return { rooms: [...head, ...fallback], matching: head.length };
}
