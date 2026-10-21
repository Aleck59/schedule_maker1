/**
 * Занятость преподавателей, аудиторий и групп по парам — для расстановки
 * экзаменов и зачётов без накладок: преподаватель не может принимать
 * две группы в одну пару, аудитория не может быть занята дважды.
 */
export interface SlotHolder {
  /**
   * Преподаватель и ключ дисциплины: одноимённые мероприятия разных групп не ставятся в одну пару,
   * даже если преподаватель ещё не назначен
   */
  teacherKeys: string[];
  classroomId?: string | null;
  groupId: string;
}

/** Занятие сетки, на месте которого можно провести зачёт (последнее занятие той же дисциплины у группы) */
export interface SlotOwner {
  groupId: string;
  itemId: string;
}

export class SlotBook {
  /** ключ слота → кто занимает (для занятий — какой группой и дисциплиной) */
  private readonly busy = new Map<string, SlotOwner[] | true>();

  private static key(kind: 't' | 'r' | 'g', id: string, date: string, pair: number) {
    return `${kind}|${id}|${date}|${pair}`;
  }

  /** Контрольное мероприятие занимает слот целиком */
  take(h: SlotHolder, date: string, pair: number) {
    for (const t of h.teacherKeys) this.busy.set(SlotBook.key('t', t, date, pair), true);
    if (h.classroomId) this.busy.set(SlotBook.key('r', h.classroomId, date, pair), true);
    this.busy.set(SlotBook.key('g', h.groupId, date, pair), true);
  }

  /** Занятие расписания: слот занят, но зачёт по той же дисциплине у той же группы может пройти на его месте */
  takeLesson(
    l: { teacherKey: string | null; classroomId: string | null; groupId: string; itemId: string },
    date: string,
    pair: number,
  ) {
    const owner = { groupId: l.groupId, itemId: l.itemId };
    for (const [kind, id] of [
      ['t', l.teacherKey],
      ['r', l.classroomId],
      ['g', l.groupId],
    ] as const) {
      if (!id) continue;
      const k = SlotBook.key(kind, id, date, pair);
      const cur = this.busy.get(k);
      if (cur === true) continue;
      this.busy.set(k, [...(cur ?? []), owner]);
    }
  }

  private free(
    kind: 't' | 'r' | 'g',
    id: string,
    date: string,
    pair: number,
    own?: SlotOwner,
    ignoreLessons = false,
  ) {
    const cur = this.busy.get(SlotBook.key(kind, id, date, pair));
    if (!cur) return true;
    if (cur === true) return false;
    if (ignoreLessons) return true;
    return !!own && cur.every((o) => o.groupId === own.groupId && o.itemId === own.itemId);
  }

  teacherFree(teacherKeys: string[], date: string, pair: number, own?: SlotOwner) {
    return teacherKeys.every((t) => this.free('t', t, date, pair, own));
  }

  roomFree(classroomId: string, date: string, pair: number, own?: SlotOwner) {
    return this.free('r', classroomId, date, pair, own);
  }

  /** ignoreLessons — зачёт можно поставить поверх обычной пары группы, но не поверх другого контрольного мероприятия */
  groupFree(groupId: string, date: string, pair: number, own?: SlotOwner, ignoreLessons = false) {
    return this.free('g', groupId, date, pair, own, ignoreLessons);
  }
}
