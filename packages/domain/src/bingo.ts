/**
 * Bingoorientering med telefonen (ADR-0225): reglerna som avgör när en ruta är tagen, hur sträckan räknas, hur serverns
 * kopia slås ihop med telefonens och topplistans ordning. Ren TypeScript; positionerna är i kartans mm (y uppåt), som
 * banläggningens rutnät, och `metersPerMm` är kartans skala (1:10 000 ger 10 m per mm).
 */

export interface BingoRect { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }
export interface BingoCellArea { readonly name: string; readonly rect: BingoRect }

/** En position: kartans mm, noggrannheten i meter och tiden i ms. */
export interface BingoFix { readonly x: number; readonly y: number; readonly accuracyM: number; readonly t: number }

export const BINGO_RULES = {
  /** En ruta tas bara med en position som är minst så här noggrann. */
  takeAccuracyM: 25,
  /** … och minst så här långt in från rutans kant (eller två positioner i rad i rutan). */
  edgeMarginM: 10,
  /** Sträckan räknas bara med positioner som är minst så här noggranna. */
  trackAccuracyM: 30,
  /** Fortare än så är ett hopp i positionen, inte löpning. */
  maxSpeedMps: 8,
  /** Ett längre uppehåll mellan positioner är ett glapp: ingen sträcka räknas rakt över det. */
  gapSeconds: 30,
  /** Sträckan växer först när löparen flyttat sig så här långt (eller halva noggrannheten) från förra punkten. */
  minStepM: 5,
  /** Spåret sparas med en punkt per så många meter eller sekunder. */
  trackStepM: 10,
  trackStepSeconds: 15,
  trackMaxPoints: 4000
} as const;

export interface BingoTaken { readonly cell: string; readonly at: number }

export interface BingoRunState {
  readonly taken: readonly BingoTaken[];
  readonly distanceM: number;
  /** Förra punkten som sträckan räknades från. */
  readonly anchor?: { readonly x: number; readonly y: number; readonly t: number } | undefined;
  /** Tiden för förra användbara positionen (glappen). */
  readonly lastFixAt?: number | undefined;
  /** Rutan som förra noggranna positionen låg i (två i rad tar rutan). */
  readonly lastCell?: string | undefined;
  /** Glappen [från, till] i ms. */
  readonly gaps: readonly (readonly [number, number])[];
  /** Spåret [x, y, ms], förenklat. */
  readonly track: readonly (readonly [number, number, number])[];
}

export const EMPTY_BINGO_RUN: BingoRunState = { taken: [], distanceM: 0, gaps: [], track: [] };

const inside = (rect: BingoRect, x: number, y: number) => x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY;
const edgeDistance = (rect: BingoRect, x: number, y: number) => Math.min(x - rect.minX, rect.maxX - x, y - rect.minY, rect.maxY - y);

/** Rutan som punkten ligger i (den första om den ligger på en gräns). */
export function bingoCellAt(cells: readonly BingoCellArea[], x: number, y: number): BingoCellArea | undefined {
  return cells.find(cell => inside(cell.rect, x, y));
}

/**
 * Nästa läge efter en position. En ruta är tagen när en position med noggrannhet ≤ 25 m ligger minst 10 m in från rutans
 * kant, eller när två sådana positioner i rad ligger i samma ruta. Sträckan växer med avståndet från förra punkten när
 * positionen är ≤ 30 m noggrann, löparen flyttat sig minst 5 m (eller halva noggrannheten) och farten är rimlig (≤ 8 m/s);
 * efter ett uppehåll på mer än 30 s räknas ingen sträcka över glappet och glappet sparas.
 */
export function bingoStep(state: BingoRunState, fix: BingoFix, cells: readonly BingoCellArea[], metersPerMm: number):
  { state: BingoRunState; newlyTaken: string[] } {
  if (!Number.isFinite(fix.x) || !Number.isFinite(fix.y) || !Number.isFinite(fix.t) || !(metersPerMm > 0)) return { state, newlyTaken: [] };
  let next: BingoRunState = state;
  const newlyTaken: string[] = [];
  if (fix.accuracyM <= BINGO_RULES.takeAccuracyM) {
    const cell = bingoCellAt(cells, fix.x, fix.y);
    if (cell) {
      const deep = edgeDistance(cell.rect, fix.x, fix.y) * metersPerMm >= BINGO_RULES.edgeMarginM;
      if ((deep || state.lastCell === cell.name) && !state.taken.some(row => row.cell === cell.name)) {
        newlyTaken.push(cell.name);
        next = { ...next, taken: [...next.taken, { cell: cell.name, at: fix.t }] };
      }
    }
    next = { ...next, lastCell: cell?.name };
  }
  if (fix.accuracyM > BINGO_RULES.trackAccuracyM) return { state: next, newlyTaken };
  const anchor = state.anchor;
  if (!anchor || state.lastFixAt === undefined) {
    return { state: { ...next, anchor: { x: fix.x, y: fix.y, t: fix.t }, lastFixAt: fix.t, track: [...next.track, [fix.x, fix.y, fix.t]] }, newlyTaken };
  }
  if (fix.t <= state.lastFixAt) return { state: next, newlyTaken };
  if (fix.t - state.lastFixAt > BINGO_RULES.gapSeconds * 1000) {
    return { state: { ...next, anchor: { x: fix.x, y: fix.y, t: fix.t }, lastFixAt: fix.t, gaps: [...next.gaps, [state.lastFixAt, fix.t]],
      track: [...next.track, [fix.x, fix.y, fix.t]] }, newlyTaken };
  }
  const meters = Math.hypot(fix.x - anchor.x, fix.y - anchor.y) * metersPerMm;
  const seconds = (fix.t - anchor.t) / 1000;
  if (seconds > 0 && meters / seconds > BINGO_RULES.maxSpeedMps) {
    // Ett hopp: positionen räknas inte, men den håller glappet borta.
    return { state: { ...next, lastFixAt: fix.t }, newlyTaken };
  }
  if (meters < Math.max(BINGO_RULES.minStepM, fix.accuracyM / 2)) return { state: { ...next, lastFixAt: fix.t }, newlyTaken };
  const last = next.track[next.track.length - 1];
  const keep = !last || Math.hypot(fix.x - last[0], fix.y - last[1]) * metersPerMm >= BINGO_RULES.trackStepM
    || fix.t - last[2] >= BINGO_RULES.trackStepSeconds * 1000;
  return { state: { ...next, distanceM: next.distanceM + meters, anchor: { x: fix.x, y: fix.y, t: fix.t }, lastFixAt: fix.t,
    track: keep && next.track.length < BINGO_RULES.trackMaxPoints ? [...next.track, [fix.x, fix.y, fix.t]] : next.track }, newlyTaken };
}

/** Löparens läge som servern sparar och telefonen skickar (hela läget varje gång; mottagningen är idempotent). */
export interface BingoProgress {
  readonly status: "RUNNING" | "FINISHED" | "ABANDONED";
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly distanceM: number;
  readonly taken: readonly BingoTaken[];
  readonly track: readonly (readonly [number, number, number])[];
  readonly gaps: readonly (readonly [number, number])[];
}

/**
 * Serverns kopia och telefonens nya läge ihop: tagna rutor som union (den tidigaste tiden), den längsta sträckan och det
 * längsta spåret, och ett avslut (mål eller avbrutet) står kvar. Bara rutor som finns i gruppen räknas.
 */
export function mergeBingoProgress(current: BingoProgress | undefined, incoming: BingoProgress, cellNames: ReadonlySet<string>): BingoProgress {
  const taken = new Map<string, number>();
  for (const row of [...(current?.taken ?? []), ...incoming.taken]) {
    if (!cellNames.has(row.cell)) continue;
    const before = taken.get(row.cell);
    if (before === undefined || row.at < before) taken.set(row.cell, row.at);
  }
  const done = current && current.status !== "RUNNING" ? current : incoming;
  return {
    status: done.status,
    startedAt: current ? Math.min(current.startedAt, incoming.startedAt) : incoming.startedAt,
    finishedAt: done.status === "RUNNING" ? null : done.finishedAt,
    distanceM: Math.max(current?.distanceM ?? 0, incoming.distanceM),
    taken: [...taken].map(([cell, at]) => ({ cell, at })).sort((a, b) => a.at - b.at || a.cell.localeCompare(b.cell)),
    track: current && current.track.length > incoming.track.length ? current.track : incoming.track,
    gaps: current && current.gaps.length > incoming.gaps.length ? current.gaps : incoming.gaps
  };
}

export interface BingoStanding {
  readonly name: string;
  readonly cells: number;
  readonly status: "RUNNING" | "FINISHED" | "ABANDONED";
  /** Tiden i sekunder: till målgången, annars till senast tagna rutan. */
  readonly seconds: number;
  readonly distanceM: number;
}

/** Topplistan: flest rutor; vid lika den som tog dem på kortast tid; avbrutna sist. */
export function rankBingo<T extends BingoStanding>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => Number(a.status === "ABANDONED") - Number(b.status === "ABANDONED") || b.cells - a.cells
    || a.seconds - b.seconds || a.name.localeCompare(b.name, "sv"));
}

/** Tiden för topplistan (sekunder): till mål, annars till senast tagna rutan. */
export function bingoSeconds(progress: Pick<BingoProgress, "startedAt" | "finishedAt" | "taken">): number {
  const end = progress.finishedAt ?? Math.max(progress.startedAt, ...progress.taken.map(row => row.at));
  return Math.max(0, Math.round((end - progress.startedAt) / 1000));
}
