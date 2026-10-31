/**
 * Цвет тепловой карты: от белого через жёлтый к тёмно-жёлтому.
 * ratio — доля занятости 0…1.
 */
const STOPS: Array<[number, [number, number, number]]> = [
  [0, [255, 255, 255]],
  [0.15, [254, 249, 214]],
  [0.5, [250, 204, 21]],
  [0.8, [202, 138, 4]],
  [1, [133, 77, 14]],
];

export function heatColor(ratio: number): string {
  const r = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i];
    if (r <= p1) {
      const [p0, c0] = STOPS[i - 1];
      const t = (r - p0) / (p1 - p0);
      const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
      return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
  }
  return 'rgb(133, 77, 14)';
}

/** Цвет текста поверх ячейки: тёмный на светлом, белый на тёмном */
export function heatTextColor(ratio: number): string {
  return ratio >= 0.72 ? '#ffffff' : '#422006';
}

/** CSS-градиент для легенды */
export const HEAT_LEGEND_GRADIENT = `linear-gradient(to right, ${STOPS.map(([p]) => `${heatColor(p)} ${p * 100}%`).join(', ')})`;
