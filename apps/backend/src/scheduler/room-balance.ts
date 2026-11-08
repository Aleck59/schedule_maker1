import { roomPreferenceCost, taggedRoomsCache } from './room-preference';
import { SolverPlacement, SolverProblem, SolverRoom } from './solver.types';

const DEFAULTS: Record<string, number> = {
  roomTypeMismatch: 20,
  preferredRoomMiss: 30,
  taggedRoomMiss: 15,
  foreignTaggedRoom: 8,
  roomBalance: 0.35,
  buildingChanges: 15,
};

/**
 * Перераспределение аудиторий без изменения времени пар: в каждом слоте пары получают аудитории
 * заново — с учётом предпочтительной аудитории из нагрузки, меток аудиторий, типа и равномерной
 * загрузки фонда за неделю (чтобы пары не скапливались в одной-двух аудиториях). Группа старается
 * остаться в той же аудитории, что и на предыдущей паре, и не переходить в другой корпус.
 * Если в слоте не удаётся рассадить всех, аудитории этого слота остаются прежними.
 */
export function rebalanceRooms(
  problem: SolverProblem,
  placements: SolverPlacement[],
): { placements: SolverPlacement[]; changed: number } {
  const weights = { ...DEFAULTS, ...(problem.weights ?? {}) };
  const rooms = new Map(problem.rooms.map((r) => [r.id, r]));
  const demands = new Map(problem.demands.map((d) => [d.id, d]));
  const setsOf = taggedRoomsCache();
  const dayInfo = new Map(problem.days.map((d) => [d.date, { weekday: d.weekday, week: d.week }]));
  const infoOf = (date: string) =>
    dayInfo.get(date) ?? (date.startsWith('T') ? { weekday: Number(date.slice(1)), week: -1 } : null);
  const unavailable = new Map(
    problem.rooms.map((r) => [r.id, new Set(r.unavailable.map(([w, l]) => `${w}#${l}`))]),
  );

  const busy = new Set<string>();
  const load = new Map<string, number>();
  for (const o of problem.occupied) {
    if (!o.roomId) continue;
    busy.add(`${o.roomId}#${o.date}#${o.lessonNumber}`);
    const info = infoOf(o.date);
    if (info) load.set(`${o.roomId}#${info.week}`, (load.get(`${o.roomId}#${info.week}`) ?? 0) + 1);
  }

  // Пары, которые переназначать нельзя: онлайн, без аудитории, числитель/знаменатель, неизвестный спрос
  const movable: number[] = [];
  const result = placements.map((p) => ({ ...p }));
  result.forEach((p, i) => {
    const room = p.roomId ? rooms.get(p.roomId) : undefined;
    const d = demands.get(p.demandId);
    const info = infoOf(p.date);
    if (!room || room.unlimited || !d || !info || p.parity) {
      if (p.roomId) busy.add(`${p.roomId}#${p.date}#${p.lessonNumber}`);
      return;
    }
    movable.push(i);
  });

  const bySlot = new Map<string, number[]>();
  for (const i of movable) {
    const p = result[i];
    const key = `${p.date}#${String(p.lessonNumber).padStart(2, '0')}`;
    bySlot.set(key, [...(bySlot.get(key) ?? []), i]);
  }
  /** Аудитория группы на последней паре дня и корпуса группы в этот день */
  const lastRoom = new Map<string, string>();
  const dayBuildings = new Map<string, Set<string>>();
  let changed = 0;

  for (const key of [...bySlot.keys()].sort()) {
    const items = bySlot.get(key)!;
    const { date, lessonNumber } = result[items[0]];
    const info = infoOf(date)!;
    const slotFree = (r: SolverRoom) =>
      !busy.has(`${r.id}#${date}#${lessonNumber}`) &&
      !unavailable.get(r.id)?.has(`${info.weekday}#${lessonNumber}`);
    const options = items.map((i) => {
      const d = demands.get(result[i].demandId)!;
      const list = d.roomIds
        .map((id) => rooms.get(id))
        .filter((r): r is SolverRoom => !!r && !r.unlimited && (slotFree(r) || r.id === result[i].roomId));
      return { i, d, list };
    });
    options.sort((a, b) => a.list.length - b.list.length);
    const taken = new Set<string>();
    const chosen = new Map<number, string>();
    let ok = true;
    for (const { i, d, list } of options) {
      let best: SolverRoom | null = null;
      let bestCost = Infinity;
      for (const r of list) {
        if (taken.has(r.id)) continue;
        let cost =
          roomPreferenceCost(d, r, weights, setsOf(d)) +
          weights.roomBalance * (load.get(`${r.id}#${info.week}`) ?? 0);
        for (const g of d.groupIds) {
          if (lastRoom.get(`${g}#${d.subgroupNumber ?? 0}#${date}`) === r.id) cost -= 1.5;
          const b = dayBuildings.get(`${g}#${date}`);
          if (r.building && b && b.size > 0 && !b.has(r.building)) cost += weights.buildingChanges;
        }
        if (r.id === result[i].roomId) cost -= 0.01;
        if (cost < bestCost) {
          best = r;
          bestCost = cost;
        }
      }
      if (!best) {
        ok = false;
        break;
      }
      taken.add(best.id);
      chosen.set(i, best.id);
    }
    for (const i of items) {
      const p = result[i];
      const roomId = ok ? chosen.get(i)! : p.roomId!;
      if (roomId !== p.roomId) changed++;
      p.roomId = roomId;
      busy.add(`${roomId}#${date}#${lessonNumber}`);
      load.set(`${roomId}#${info.week}`, (load.get(`${roomId}#${info.week}`) ?? 0) + 1);
      const d = demands.get(p.demandId)!;
      const building = rooms.get(roomId)?.building;
      for (const g of d.groupIds) {
        lastRoom.set(`${g}#${d.subgroupNumber ?? 0}#${date}`, roomId);
        if (building) {
          const set = dayBuildings.get(`${g}#${date}`) ?? new Set<string>();
          set.add(building);
          dayBuildings.set(`${g}#${date}`, set);
        }
      }
    }
  }
  return { placements: result, changed };
}
