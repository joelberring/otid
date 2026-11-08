import { MAX_SEGMENT_M } from "./recon";

/**
 * ADR-0219 tillägget om spelifieringen (K3b): statistiken för en person, ur det som redan finns. Belöna rätt saker (planens
 * 7c): rekad yta, kollade objekt och åtgärdade kartfel väger tyngst; borttagna objekt (generalisering) räknas; det Claude
 * föreslog räknas inte som personens (det tas bort innan siffrorna kommer hit). Rena funktioner.
 */
export interface MapStats {
  readonly projects: number;
  readonly tracks: number;
  readonly km: number;
  readonly hours: number;
  /** Rekad yta: rutor om 10 × 10 m inom 20 m från personens spår (överlapp räknas en gång per projekt). */
  readonly hectares: number;
  readonly added: number;
  readonly changed: number;
  readonly deleted: number;
  readonly checked: number;
  readonly notesWritten: number;
  readonly notesResolved: number;
  readonly proposalsAccepted: number;
  readonly areasDone: number;
  /** Något spår startade mellan 20 och 05 (svensk tid). */
  readonly night: boolean;
}

export const EMPTY_STATS: MapStats = { projects: 0, tracks: 0, km: 0, hours: 0, hectares: 0, added: 0, changed: 0, deleted: 0, checked: 0,
  notesWritten: 0, notesResolved: 0, proposalsAccepted: 0, areasDone: 0, night: false };

/** Summan av flera projekts statistik. */
export function addStats(a: MapStats, b: MapStats): MapStats {
  return { projects: a.projects + b.projects, tracks: a.tracks + b.tracks, km: a.km + b.km, hours: a.hours + b.hours, hectares: a.hectares + b.hectares,
    added: a.added + b.added, changed: a.changed + b.changed, deleted: a.deleted + b.deleted, checked: a.checked + b.checked,
    notesWritten: a.notesWritten + b.notesWritten, notesResolved: a.notesResolved + b.notesResolved,
    proposalsAccepted: a.proposalsAccepted + b.proposalsAccepted, areasDone: a.areasDone + b.areasDone, night: a.night || b.night };
}

/** En spårpunkt som servern sparar den: [lat, lon, sekunder, noggrannhet i meter]. */
export type StoredTrackPoint = readonly [number, number, number, number];

/**
 * Rekad yta i hektar: rutor om `cellM` meter vars mitt ligger inom `radiusM` från något av spåren (lokal plan projektion kring
 * det första spårets början). En lucka över MAX_SEGMENT_M räknas inte.
 */
export function coveredHectares(tracks: readonly (readonly StoredTrackPoint[])[], radiusM = 20, cellM = 10): number {
  const first = tracks.find(track => track.length > 0)?.[0];
  if (!first) return 0;
  const cos = Math.cos(first[0] * Math.PI / 180);
  const xy = (point: StoredTrackPoint) => ({ x: (point[1] - first[1]) * 111_320 * cos, y: (point[0] - first[0]) * 110_574 });
  const covered = new Set<string>();
  const mark = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const c0 = Math.floor((Math.min(a.x, b.x) - radiusM) / cellM), c1 = Math.floor((Math.max(a.x, b.x) + radiusM) / cellM);
    const r0 = Math.floor((Math.min(a.y, b.y) - radiusM) / cellM), r1 = Math.floor((Math.max(a.y, b.y) + radiusM) / cellM);
    for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) {
      const key = `${c},${r}`;
      if (covered.has(key)) continue;
      const px = (c + 0.5) * cellM, py = (r + 0.5) * cellM;
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / length));
      if (Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy)) <= radiusM) covered.add(key);
    }
  };
  for (const track of tracks) {
    const points = track.map(xy);
    if (points.length === 1) mark(points[0]!, points[0]!);
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1]!, b = points[i]!;
      if (Math.hypot(b.x - a.x, b.y - a.y) <= MAX_SEGMENT_M) mark(a, b);
    }
  }
  return covered.size * cellM * cellM / 10_000;
}

/** Märkena (planens 7c): för det som är värt att göra, inte för mängden objekt. */
export const BADGES = [
  { id: "FIRST_TRACK", earned: (s: MapStats) => s.tracks >= 1 },
  { id: "TEN_KM", earned: (s: MapStats) => s.km >= 10 },
  { id: "HUNDRED_KM", earned: (s: MapStats) => s.km >= 100 },
  { id: "TEN_HECTARES", earned: (s: MapStats) => s.hectares >= 10 },
  { id: "NIGHT", earned: (s: MapStats) => s.night },
  { id: "HUNDRED_CHECKED", earned: (s: MapStats) => s.checked >= 100 },
  { id: "TEN_NOTES_RESOLVED", earned: (s: MapStats) => s.notesResolved >= 10 },
  { id: "AREA_DONE", earned: (s: MapStats) => s.areasDone >= 1 },
  { id: "GENERALIZER", earned: (s: MapStats) => s.deleted >= 50 }
] as const;
export type BadgeId = (typeof BADGES)[number]["id"];

export function earnedBadges(stats: MapStats): BadgeId[] {
  return BADGES.filter(badge => badge.earned(stats)).map(badge => badge.id);
}

/** Startade spåret på natten (20–05 svensk tid)? */
export function nightStart(iso: string | null): boolean {
  if (!iso) return false;
  const hour = Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", hour12: false }).format(new Date(iso)));
  return hour >= 20 || hour < 5;
}
