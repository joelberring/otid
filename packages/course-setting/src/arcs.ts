/** Bågar på en ring i grader moturs från x-axeln (samma som `CircleGap`). Ren geometri för ringavbrotten. */

export interface Arc { readonly startDegrees: number; readonly endDegrees: number }

/** Avbrott i grader slås ihop när de överlappar (CircleGap.SimplifyGaps i Purple Pen, BSD). Start i [0, 360). */
export function simplifyGaps(gaps: readonly Arc[]): Arc[] {
  const intervals: [number, number][] = [];
  for (const gap of gaps) {
    let start = ((gap.startDegrees % 360) + 360) % 360;
    let end = start + Math.min(360, Math.max(0, gap.endDegrees - gap.startDegrees));
    if (end - start >= 360) return [{ startDegrees: 0, endDegrees: 360 }];
    if (end > 360) { intervals.push([start, 360]); start = 0; end -= 360; }
    intervals.push([start, end]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of intervals) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  if (merged.length > 1 && merged[0]![0] === 0 && merged[merged.length - 1]![1] === 360) {
    const first = merged.shift()!;
    merged[merged.length - 1]![1] = 360 + first[1];
  }
  return merged.map(([startDegrees, endDegrees]) => ({ startDegrees, endDegrees }));
}

/** Hur många grader avbrotten tar tillsammans (överlapp räknas en gång). */
export function totalDegrees(gaps: readonly Arc[]): number {
  return simplifyGaps(gaps).reduce((sum, gap) => sum + gap.endDegrees - gap.startDegrees, 0);
}

/**
 * Avbrotten sammanslagna, och bitar av ringen som är kortare än `minPieceDegrees` mellan två avbrott tas också bort
 * (en kort bit läses som en prick, inte som en del av ringen).
 */
export function mergeClose(gaps: readonly Arc[], minPieceDegrees: number): Arc[] {
  const sorted = simplifyGaps(gaps);
  if (sorted.length === 0 || minPieceDegrees <= 0) return sorted;
  const out: { startDegrees: number; endDegrees: number }[] = [];
  for (const gap of sorted) {
    const last = out[out.length - 1];
    if (last && gap.startDegrees - last.endDegrees < minPieceDegrees) last.endDegrees = Math.max(last.endDegrees, gap.endDegrees);
    else out.push({ ...gap });
  }
  // Biten mellan sista och första avbrottet (över 0°).
  const first = out[0]!;
  const last = out[out.length - 1]!;
  if (out.length > 1 && first.startDegrees + 360 - last.endDegrees < minPieceDegrees) {
    last.endDegrees = Math.max(last.endDegrees, first.endDegrees + 360);
    out.shift();
  } else if (out.length === 1 && 360 - (first.endDegrees - first.startDegrees) < minPieceDegrees) {
    return [{ startDegrees: 0, endDegrees: 360 }];
  }
  return simplifyGaps(out);
}

/** Vinkeln (grader) ligger i bågen, med `marginDegrees` på båda sidor. */
export function arcContains(arc: Arc, degrees: number, marginDegrees = 0): boolean {
  const start = arc.startDegrees - marginDegrees;
  const end = arc.endDegrees + marginDegrees;
  if (end - start >= 360) return true;
  const offset = (((degrees - start) % 360) + 360) % 360;
  return offset <= end - start;
}

/** Bågar ur prov runt ringen (`blocked[i]` för vinkeln `i · 360 / n`): sammanhängande prov blir en båge, runt 0° också. */
export function arcsFromSamples(blocked: ArrayLike<boolean | number>, step: number): Arc[] {
  const n = blocked.length;
  let any = false, all = true;
  for (let i = 0; i < n; i++) { if (blocked[i]) any = true; else all = false; }
  if (!any) return [];
  if (all) return [{ startDegrees: 0, endDegrees: 360 }];
  let first = 0;
  while (blocked[first]) first++;
  const arcs: Arc[] = [];
  let start: number | undefined;
  for (let k = 1; k <= n; k++) {
    const i = (first + k) % n;
    if (blocked[i] && start === undefined) start = first + k;
    if (!blocked[i] && start !== undefined) {
      // Kanten ligger mitt mellan sista blockerade och första fria provet.
      arcs.push({ startDegrees: (start - 0.5) * step, endDegrees: (first + k - 0.5) * step });
      start = undefined;
    }
  }
  return arcs.map(arc => {
    const shift = Math.floor(arc.startDegrees / 360) * 360;
    return { startDegrees: arc.startDegrees - shift, endDegrees: arc.endDegrees - shift };
  });
}
