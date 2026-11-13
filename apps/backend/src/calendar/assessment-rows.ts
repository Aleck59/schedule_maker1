import { ControlForm, PrismaClient } from '@prisma/client';
import { parseDate, toDateStr } from '../common/utils/dates';

/** Короткая пометка формы контроля для сетки и печатных форм расписания */
export const ASSESSMENT_MARK: Partial<Record<ControlForm, string>> = {
  EXAM: 'экзамен',
  QUALIFICATION_EXAM: 'квалиф. экзамен',
  CREDIT: 'зачёт',
  DIFFERENTIATED_CREDIT: 'диф. зачёт',
  COURSE_PROJECT: 'защита КП',
};

export function assessmentMark(form: ControlForm): string {
  return ASSESSMENT_MARK[form] ?? 'контроль';
}

export interface AssessmentRow {
  groupId: string;
  date: string;
  lessonNumber: number;
  subject: string;
  teacher: string | null;
  room: string | null;
  controlForm: ControlForm;
}

/**
 * Экзамены и зачёты, назначенные на пару (вкладка «Экзамены и зачёты»), для печатных форм расписания:
 * название дисциплины с пометкой «(экзамен)» / «(зачёт)».
 */
export async function loadAssessmentRows(
  prisma: Pick<PrismaClient, 'assessmentEvent'>,
  organizationId: string,
  from: string,
  to: string,
  groupIds?: string[],
): Promise<AssessmentRow[]> {
  const events = await prisma.assessmentEvent.findMany({
    where: {
      group: { program: { organizationId } },
      studentGroupId: groupIds ? { in: groupIds } : undefined,
      lessonNumber: { not: null },
      date: { gte: parseDate(from), lte: parseDate(to) },
    },
    include: {
      semesterItem: { select: { curriculumItem: { select: { name: true } } } },
      teacher: { select: { fullName: true } },
      classroom: { select: { code: true } },
    },
  });
  return events.map((e) => ({
    groupId: e.studentGroupId,
    date: toDateStr(e.date),
    lessonNumber: e.lessonNumber!,
    subject: `${e.semesterItem.curriculumItem.name} (${assessmentMark(e.controlForm)})`,
    teacher: e.teacher?.fullName ?? null,
    room: e.classroom?.code ?? null,
    controlForm: e.controlForm,
  }));
}
