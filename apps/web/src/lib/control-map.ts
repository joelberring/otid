/**
 * Steg 52 (ADR-0176): kontrollkartans ritning utan React. Lägena kommer i serverns ram (kartbildens pixlar eller meter);
 * här väljs utsnitt, storlek på ringar och text, sträckornas linjer (kortade vid ringarna, som på en orienteringskarta),
 * skalstock och belastningens nivå.
 */
export type XY = { readonly x: number; readonly y: number };
export type Bounds = { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };

export interface ControlMapView {
  readonly viewBox: string;
  readonly x: number; readonly y: number; readonly width: number; readonly height: number;
  /** Ringens radie i ramens enheter (läsbar oavsett skala). */
  readonly radius: number;
  readonly fontSize: number;
}

/** Medianen av avståndet till närmaste granne (för ringarnas storlek när kontrollerna ligger tätt). */
export function typicalSpacing(points: readonly XY[]): number | null {
  if (points.length < 2) return null;
  const nearest = points.map((point, index) => Math.min(...points.flatMap((other, otherIndex) =>
    otherIndex === index ? [] : [Math.hypot(other.x - point.x, other.y - point.y)])));
  const sorted = nearest.filter(value => value > 0).sort((left, right) => left - right);
  return sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Utsnittet runt punkterna med marginal; minst så stort att en ensam kontroll syns. Kartbilden beskärs till utsnittet.
 * Ringarna är som standard 1,4 % av utsnittet men mindre när kontrollerna ligger tätt (en tredjedel av typiskt avstånd).
 */
export function controlMapView(bounds: Bounds | null, image?: { width: number; height: number } | null, spacing?: number | null): ControlMapView | null {
  if (!bounds) return null;
  const spanX = bounds.maxX - bounds.minX, spanY = bounds.maxY - bounds.minY;
  const span = Math.max(spanX, spanY, image ? 200 : 200);
  const margin = span * 0.08 + (image ? 30 : 20);
  let x = bounds.minX - margin, y = bounds.minY - margin;
  let width = spanX + 2 * margin, height = spanY + 2 * margin;
  // Inte smalare än 3:4 eller bredare än 2:1, så att bilden går att läsa på mobilen och datorn.
  if (height > width * 4 / 3) { const grow = height * 3 / 4 - width; x -= grow / 2; width += grow; }
  if (width > height * 2) { const grow = width / 2 - height; y -= grow / 2; height += grow; }
  if (image) {
    // Inom kartbilden när den räcker.
    if (width <= image.width) x = Math.min(Math.max(x, 0), image.width - width);
    if (height <= image.height) y = Math.min(Math.max(y, 0), image.height - height);
  }
  const span2 = Math.max(width, height);
  const radius = spacing ? Math.min(span2 * 0.014, Math.max(span2 * 0.005, spacing * 0.33)) : span2 * 0.014;
  const r = (value: number) => Math.round(value * 10) / 10;
  return { viewBox: `${r(x)} ${r(y)} ${r(width)} ${r(height)}`, x: r(x), y: r(y), width: r(width), height: r(height),
    radius: r(radius), fontSize: r(Math.max(radius * 1.25, span2 * 0.016)) };
}

/** Sträckan mellan två punkter, kortad vid ringarna; undefined när punkterna nästan sammanfaller. */
export function legLine(from: XY, to: XY, gap: number): { x1: number; y1: number; x2: number; y2: number } | undefined {
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
  if (length <= gap * 2.2) return undefined;
  const ux = dx / length, uy = dy / length;
  return { x1: from.x + ux * gap, y1: from.y + uy * gap, x2: to.x - ux * gap, y2: to.y - uy * gap };
}

/** Kontrollnumret bredvid ringen, på den sida som är längst från sträckorna in och ut. */
export function numberPlace(point: XY, previous: XY | undefined, next: XY | undefined, distance: number): XY {
  const away = [previous, next].reduce<XY>((sum, other) => {
    if (!other) return sum;
    const dx = point.x - other.x, dy = point.y - other.y, length = Math.hypot(dx, dy) || 1;
    return { x: sum.x + dx / length, y: sum.y + dy / length };
  }, { x: 0, y: 0 });
  const length = Math.hypot(away.x, away.y);
  const ux = length < 0.01 ? 0.7 : away.x / length, uy = length < 0.01 ? -0.7 : away.y / length;
  return { x: point.x + ux * distance, y: point.y + uy * distance };
}

/** Skalstock: ett jämnt avstånd i meter nära en femtedel av utsnittets bredd. Null när skalan är okänd. */
export function scaleBar(metersPerUnit: number | null, viewWidth: number): { meters: number; units: number } | null {
  if (!metersPerUnit || metersPerUnit <= 0) return null;
  const target = viewWidth * metersPerUnit / 5;
  const nice = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
  const meters = nice.reduce((best, value) => Math.abs(Math.log(value / target)) < Math.abs(Math.log(best / target)) ? value : best, nice[0]!);
  return { meters, units: meters / metersPerUnit };
}

/** Belastningens nivå 0–3 (0 = ingen) relativt den mest belastade kontrollen. */
export function loadLevel(value: number, max: number): 0 | 1 | 2 | 3 {
  if (value <= 0 || max <= 0) return 0;
  const share = value / max;
  return share > 2 / 3 ? 3 : share > 1 / 3 ? 2 : 1;
}

/** Ringens radie för belastningen: större ring för mer belastad kontroll (1–1,8 gånger grundradien). */
export function loadRadius(radius: number, value: number, max: number): number {
  return max <= 0 ? radius : radius * (1 + 0.8 * Math.sqrt(Math.max(0, value) / max));
}
