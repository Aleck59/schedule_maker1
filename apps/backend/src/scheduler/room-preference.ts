import { SolverDemand, SolverRoom } from './solver.types';

export interface DemandRoomSets {
  /** Аудитории по меткам дисциплины */
  tagged: Set<string>;
  /** Запасные кабинеты (не того типа): идут в roomIds после первых matchingRooms */
  fallback: Set<string>;
}

/** Кэш наборов аудиторий спроса (метки, запасные) */
export function taggedRoomsCache(): (d: SolverDemand) => DemandRoomSets {
  const cache = new Map<SolverDemand, DemandRoomSets>();
  return (d) => {
    let sets = cache.get(d);
    if (!sets) {
      const m = d.matchingRooms;
      sets = {
        tagged: new Set(d.taggedRoomIds ?? []),
        fallback: new Set(m === undefined || m >= d.roomIds.length ? [] : d.roomIds.slice(m)),
      };
      cache.set(d, sets);
    }
    return sets;
  };
}

/**
 * Штраф за аудиторию для пары (мягкие ограничения): не предпочтительная из нагрузки, не по меткам
 * дисциплины, с метками другой дисциплины, не того типа, слишком большая. Онлайн-аудитория без штрафов.
 */
export function roomPreferenceCost(
  d: SolverDemand,
  room: SolverRoom,
  weights: Record<string, number>,
  sets: DemandRoomSets,
): number {
  if (room.unlimited) return 0;
  let cost = Math.max(0, room.capacity - d.size) / 100;
  const isPreferred = d.preferredRoomId === room.id;
  if (d.preferredRoomId && !isPreferred) cost += weights.preferredRoomMiss ?? 0;
  if (!isPreferred) {
    const byTag = sets.tagged.has(room.id);
    if (sets.tagged.size > 0 && !byTag) cost += weights.taggedRoomMiss ?? 0;
    if (room.tagged && !byTag) cost += weights.foreignTaggedRoom ?? 0;
  }
  if (sets.fallback.has(room.id)) cost += weights.roomTypeMismatch ?? 0;
  return cost;
}
