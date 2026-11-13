import { pluralize } from '@/lib/format';
import { LESSON_TYPE_LABELS } from '@/lib/labels';
import type { Assignment, SemesterItem } from '@/lib/types';

const HOURS_SHORT: Array<[keyof SemesterItem, string]> = [
  ['lectureHours', 'Л'],
  ['practicalHours', 'П'],
  ['laboratoryHours', 'Лаб'],
  ['consultationHours', 'Конс'],
];

/** «Л 18 · П 36» — часы дисциплины по видам занятий */
export function hoursText(item: SemesterItem): string {
  const parts = HOURS_SHORT.filter(([k]) => (item[k] as number) > 0).map(([k, l]) => `${l} ${item[k] as number}`);
  if (item.practiceAtCollege && item.practiceHours) parts.push(`Практ ${item.practiceHours}`);
  return parts.join(' · ');
}

export function contactHours(item: SemesterItem): number {
  return item.lectureHours + item.practicalHours + item.laboratoryHours + item.consultationHours + (item.practiceAtCollege ? item.practiceHours : 0);
}

/** «Все виды · вся группа» по умолчанию, иначе вид занятий и подгруппа */
export function lessonsText(a: Assignment): string {
  return `${a.lessonType ? LESSON_TYPE_LABELS[a.lessonType] : 'все виды'}${a.subgroupNumber ? ` · п/г ${a.subgroupNumber}` : ''}`;
}

/** Только заданные вручную особенности: темп, поток, аудитория, превышение */
export function featuresText(a: Assignment): string {
  return [
    a.weeklyLessonTarget ? `${a.weeklyLessonTarget} ${pluralize(a.weeklyLessonTarget, 'пара', 'пары', 'пар')}/нед` : null,
    a.streamKey ? `поток ${a.streamKey}` : null,
    a.preferredClassroom ? `ауд. ${a.preferredClassroom.code}` : a.classroomTypes.length ? 'свои типы аудиторий' : null,
    a.allowHoursExcess ? 'превышение разрешено' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Назначение «все виды занятий, вся группа» — без особенностей, показывается приглушённо */
export function isDefaultLessons(a: Pick<Assignment, 'lessonType' | 'subgroupNumber'>): boolean {
  return !a.lessonType && !a.subgroupNumber;
}

/** Виды занятий дисциплины с часами (практика — только если проходит в колледже) */
export function itemLessonTypes(item: SemesterItem): Array<{ type: string; hours: number }> {
  const all: Array<[string, number]> = [
    ['LECTURE', item.lectureHours],
    ['PRACTICAL', item.practicalHours],
    ['LABORATORY', item.laboratoryHours],
    ['CONSULTATION', item.consultationHours],
    ['PRACTICE', item.practiceAtCollege ? item.practiceHours : 0],
  ];
  return all.filter(([, h]) => h > 0).map(([type, hours]) => ({ type, hours }));
}

/**
 * Виды занятий, которые не покрыты ни одним назначением: назначение «все виды» покрывает всё,
 * иначе каждый вид нужно назначить отдельно (например, лекции — одному преподавателю, практику — другому).
 */
export function uncoveredTypes(
  item: SemesterItem,
  list: Array<Pick<Assignment, 'lessonType'>>,
): Array<{ type: string; hours: number }> {
  if (list.length === 0 || list.some((a) => !a.lessonType)) return [];
  const covered = new Set(list.map((a) => a.lessonType));
  return itemLessonTypes(item).filter((t) => !covered.has(t.type as Assignment['lessonType']));
}
