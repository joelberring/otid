/**
 * Automatisk klippning av kontrollringar (ADR-0180 beslut 10), valbar i händelsens `circleCutting`:
 * - **overlap**: där två ringar på samma kartbild går in i varandra tas bågen inne i den andra ringen bort, för båda,
 *   så att konturen syns (också målets dubbelring). Passager och starttrianglar klipper ringen men klipps inte själva.
 * - **details**: gapen över viktiga kartdetaljer (`detail-gaps.ts`), räknade i webbläsarens Worker och givna till
 *   `layoutOverprint` som `detailGaps`. De kan göras fasta i kontrollernas `circleGaps` (`bakeDetailGapEdits`) och följer
 *   då med till Purple Pen; överlappsklippen beror på banan och görs aldrig fasta.
 */
import type { Point } from "@o-tid/map-file";
import { arcContains, arcsFromSamples, simplifyGaps, totalDegrees, type Arc } from "./arcs";
import { appearanceOf, circleGapScale, sizesFor } from "./appearance";
import type { DetailCircle } from "./detail-gaps";
import { angleDegrees, distance, nearestOnSegment } from "./geometry";
import { legKey } from "./ppen-common";
import type { CircleGap, ControlPoint, CourseSettingDocument, CourseSettingEdit } from "./types";
import { enumerateCourseControls, enumerateLegs } from "./walk";

/** Gränsvärdena för överlappsklippen. */
export const OVERLAP_CUT_LIMITS = {
  /**
   * Kraftig överlappning: mittpunkterna närmare än så här stor del av radiesumman. Då behålls hela ringen för den ena.
   * Samma gräns som Purple Pens automatiska avbrott (CourseFormatter.CutControlWithRespectTo, 0,35), där Purple Pen
   * slutar klippa.
   */
  strongFraction: 0.35,
  /** Ingen ring tappar mer än så här stor del av sig själv (ägarens krav: "ungefär hälften"). */
  maxFraction: 0.5,
  /** Två kontroller i samma punkt (mm): ringarna ligger på varandra och klipps inte. */
  samePointMm: 0.01,
  /** Fritt avstånd i ringens linjebredder mellan ringen och en passage (egen tumregel: passagen ska stå fri). */
  passageClearanceLineWidths: 1,
  /** Provtagning runt ringen mot start och passage (grader). */
  sampleDegrees: 1
} as const;

/** En figur på kartbilden som överlappsklippen räknar med. */
export interface OverlapFigure {
  readonly at: Point;
  /** Ringarnas radier till linjens mitt: kontroll en, mål två (yttre först); tom för start och passage. */
  readonly rings: readonly number[];
  readonly lineWidth: number;
  /** Start- och passagefigurens linjer (stängd = triangel, ringen klipps där den går inne i den). */
  readonly lines?: readonly { readonly points: readonly Point[]; readonly closed: boolean }[] | undefined;
  /** Lägre behåller hela ringen vid kraftig överlappning (mål först, sedan tidigare på banan). */
  readonly rank: number;
}

const toDegrees = (radians: number) => radians * 180 / Math.PI;

/** Bågen av ringen (radie `r` kring `a`) som ligger inne i cirkeln kring `b` med radie `rb`; null = ingen, "ALL" = hela. */
function arcInside(a: Point, r: number, b: Point, rb: number): Arc | "ALL" | null {
  const d = distance(a, b);
  if (d < 1e-12) return r < rb ? "ALL" : null;
  const cos = (r * r + d * d - rb * rb) / (2 * r * d);
  if (cos >= 1) return null;
  if (cos <= -1) return "ALL";
  const half = toDegrees(Math.acos(cos));
  const toward = angleDegrees(a, b);
  return { startDegrees: toward - half, endDegrees: toward + half };
}

const arcLength = (arc: Arc | "ALL" | null) => arc === null ? 0 : arc === "ALL" ? 360 : arc.endDegrees - arc.startDegrees;

function pointInPolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Bågarna av ringen som går inne i en starttriangel eller nära en passages linjer. */
function arcsAtFigure(at: Point, r: number, lineWidth: number, figure: OverlapFigure): Arc[] {
  const step = OVERLAP_CUT_LIMITS.sampleDegrees;
  const n = Math.round(360 / step);
  const clearance = lineWidth * (1 + OVERLAP_CUT_LIMITS.passageClearanceLineWidths);
  const blocked = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = i * step * Math.PI / 180;
    const p = { x: at.x + r * Math.cos(a), y: at.y + r * Math.sin(a) };
    for (const line of figure.lines ?? []) {
      if (line.closed && pointInPolygon(p, line.points)) { blocked[i] = 1; break; }
      if (!line.closed && line.points.some((q, k) => k > 0 && nearestOnSegment(p, line.points[k - 1]!, q).distance < clearance)) { blocked[i] = 1; break; }
    }
  }
  return arcsFromSamples(blocked, step);
}

interface Contribution { readonly figure: number; readonly ring: number; readonly arc: Arc; readonly pair: number }

/**
 * Överlappsklippen per figur och ring (samma ordning som `figure.rings`). Tar bågarna mer än hälften av en ring tas
 * ringens största bort först; ringen behåller då sin del inne i den andra, som vid kraftig överlappning.
 */
export function overlapGaps(figures: readonly OverlapFigure[]): Arc[][][] {
  const contributions: Contribution[] = [];
  let pair = 0;
  const add = (figure: number, ring: number, arc: Arc | "ALL" | null, id: number) => {
    if (arc === null) return;
    contributions.push({ figure, ring, arc: arc === "ALL" ? { startDegrees: 0, endDegrees: 360 } : arc, pair: id });
  };
  const half = 360 * OVERLAP_CUT_LIMITS.maxFraction;
  const outer = (index: number) => figures[index]!.rings[0]!;
  const cutRings = (target: number, other: number, id: number) => figures[target]!.rings.forEach((r, ring) =>
    add(target, ring, arcInside(figures[target]!.at, r, figures[other]!.at, outer(other)), id));
  const loses = (target: number, other: number) => arcLength(arcInside(figures[target]!.at, outer(target), figures[other]!.at, outer(other)));
  const rings = figures.flatMap((figure, index) => figure.rings.length > 0 ? [index] : []);
  // Två ringar: båda klipps, eller vid kraftig överlappning bara den ena.
  for (const i of rings) {
    for (const j of rings) {
      if (j <= i) continue;
      const d = distance(figures[i]!.at, figures[j]!.at);
      const ri = outer(i), rj = outer(j);
      if (d >= ri + rj || d < OVERLAP_CUT_LIMITS.samePointMm) continue;
      const id = pair++;
      if (d >= OVERLAP_CUT_LIMITS.strongFraction * (ri + rj) && d > Math.abs(ri - rj)) { cutRings(i, j, id); cutRings(j, i, id); continue; }
      const [keeper, loser] = figures[i]!.rank <= figures[j]!.rank ? [i, j] : [j, i];
      if (loses(loser, keeper) <= half) cutRings(loser, keeper, id);
      else if (loses(keeper, loser) <= half) cutRings(keeper, loser, id);
    }
  }
  // Ring mot start eller passage: bara ringen klipps.
  for (const i of rings) {
    const ringFigure = figures[i]!;
    figures.forEach(other => {
      if (other.rings.length > 0 || !other.lines || other.lines.length === 0) return;
      const reach = Math.max(0, ...other.lines.flatMap(line => line.points.map(p => distance(p, other.at)))) + other.lineWidth * 2;
      if (distance(ringFigure.at, other.at) >= outer(i) + reach) return;
      const id = pair++;
      ringFigure.rings.forEach((r, ring) => { for (const arc of arcsAtFigure(ringFigure.at, r, ringFigure.lineWidth, other)) add(i, ring, arc, id); });
    });
  }
  // Taket: högst hälften av varje ring (också målets inre, t.ex. med starttriangeln ovanpå). Ringens största bidrag tas
  // bort först (bara för den här figuren: den andra ringen klipps fortfarande, som vid kraftig överlappning).
  const dropped = new Set<string>();
  const kept = (c: Contribution) => !dropped.has(`${c.figure}:${c.pair}`);
  figures.forEach((figure, index) => {
    figure.rings.forEach((_, ring) => {
      const own = () => contributions.filter(c => c.figure === index && c.ring === ring && kept(c));
      while (totalDegrees(own().map(c => c.arc)) > half + 1e-9) {
        const largest = [...own()].sort((x, y) => (y.arc.endDegrees - y.arc.startDegrees) - (x.arc.endDegrees - x.arc.startDegrees))[0]!;
        dropped.add(`${index}:${largest.pair}`);
      }
    });
  });
  return figures.map((figure, index) => figure.rings.map((_, ring) =>
    simplifyGaps(contributions.filter(c => c.figure === index && c.ring === ring && kept(c)).map(c => c.arc))));
}

/**
 * Detaljgapen för en ring på en kartbild: inte där en sträcka går ut ur ringen (`legDegrees`), och tillsammans med
 * överlappsklippen högst hälften av ringen (de kortaste detaljgapen tas bort först).
 */
export function detailGapsForView(detail: readonly Arc[], overlap: readonly Arc[], legDegrees: readonly number[], radius: number, lineWidth: number): Arc[] {
  const legMargin = toDegrees(lineWidth / radius);
  const kept = detail.filter(arc => !legDegrees.some(angle => arcContains(arc, angle, legMargin)))
    .sort((x, y) => (y.endDegrees - y.startDegrees) - (x.endDegrees - x.startDegrees));
  const limit = 360 * OVERLAP_CUT_LIMITS.maxFraction;
  while (kept.length > 0 && totalDegrees([...overlap, ...kept]) > limit + 1e-9) kept.pop();
  return kept;
}

/** Vinklarna där sträckorna går ut ur kontrollerna, på alla banor (mot första brytpunkten eller nästa kontroll). */
function legAnglesByControl(document: CourseSettingDocument): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const add = (control: string, angle: number) => out.set(control, [...(out.get(control) ?? []), angle]);
  for (const course of document.courses) {
    for (const [a, b] of enumerateLegs(document, course.id)) {
      const from = document.controls[document.courseControls[a]?.control ?? ""];
      const to = document.controls[document.courseControls[b]?.control ?? ""];
      if (!from || !to || from.id === to.id) continue;
      const bends = document.legs[legKey(from.id, to.id)]?.bends ?? [];
      const first = bends[0] ?? to.at, last = bends[bends.length - 1] ?? from.at;
      if (distance(from.at, first) > 0) add(from.id, angleDegrees(from.at, first));
      if (distance(to.at, last) > 0) add(to.id, angleDegrees(to.at, last));
    }
  }
  return out;
}

/**
 * Nyckeln för en rings detaljgap i `OverprintOptions.detailGaps`: kontrollen och ringens radie, eftersom gapens vinklar
 * beror på ringens storlek (en kontroll kan synas i flera utskriftsskalor, och målet har två ringar).
 */
export const detailGapKey = (control: string, radiusMm: number) => `${control}@${radiusMm.toFixed(3)}`;

function allControlsScale(document: CourseSettingDocument): number {
  return document.event.allControlsPrintScale ?? document.event.mapScale;
}

/**
 * Utskriftsskalorna där kontrollen syns: banornas och alla kontrollers, och `extra` (kartor med egen skala i utskriften,
 * `SheetItem.printScale`, gäller alla kontroller: ringarna är då större eller mindre än i banans skala).
 */
function printScalesOf(document: CourseSettingDocument, extra: readonly number[] = []): (control: string) => number[] {
  const out = new Map<string, Set<number>>();
  for (const course of document.courses) {
    const scale = course.printScale ?? document.event.mapScale;
    for (const id of enumerateCourseControls(document, course.id)) {
      const control = document.courseControls[id]?.control;
      if (control) out.set(control, (out.get(control) ?? new Set()).add(scale));
    }
  }
  const all = [allControlsScale(document), ...extra.filter(scale => Number.isFinite(scale) && scale > 0)];
  return control => [...new Set([...(out.get(control) ?? []), ...all])].sort((a, b) => a - b);
}

/** Ringarnas radier (kontroll en, mål två, yttre först) och linjebredd vid en utskriftsskala. */
function ringsAt(document: CourseSettingDocument, kind: ControlPoint["kind"], scale: number): { radii: number[]; line: number } {
  const sizes = sizesFor(document, scale);
  return { radii: kind === "FINISH" ? [sizes.finishOuter / 2, sizes.finishInner / 2] : [sizes.control / 2], line: sizes.line };
}

/**
 * Ringarna som detaljgapen räknas för: alla vanliga kontroller och mål, en ring per storlek som syns i banornas och alla
 * kontrollers utskriftsskalor (id = `detailGapKey`), med vinklarna där sträckorna går ut på någon bana.
 */
export function detailCircles(document: CourseSettingDocument, extraScales: readonly number[] = []): DetailCircle[] {
  const scalesOf = printScalesOf(document, extraScales);
  const legs = legAnglesByControl(document);
  const out: DetailCircle[] = [];
  for (const control of Object.values(document.controls)) {
    if (control.kind !== "NORMAL" && control.kind !== "FINISH") continue;
    const blocked = legs.get(control.id);
    const seen = new Set<string>();
    for (const scale of scalesOf(control.id)) {
      const { radii, line } = ringsAt(document, control.kind, scale);
      for (const radius of radii) {
        const id = detailGapKey(control.id, radius);
        if (seen.has(id) || !(radius > 0)) continue;
        seen.add(id);
        out.push({ id, at: control.at, radiusMm: radius, lineWidthMm: line, ...(blocked ? { blockedDegrees: blocked } : {}) });
      }
    }
  }
  return out;
}

/** Ringavbrotten som gäller vid en sparad skala (QueryEvent.GetControlGaps, se `fileGaps` i overprint.ts). */
export function gapsAtScale(document: CourseSettingDocument, control: ControlPoint, scale: number): CircleGap[] {
  const gaps = control.circleGaps ?? [];
  if (gaps.length === 0) return [];
  const appearance = appearanceOf(document);
  const of = (s: number | null) => gaps.filter(gap => gap.scale === s);
  let found: CircleGap[] = of(scale);
  if (found.length === 0) found = of(null);
  if (found.length === 0 && !appearance.circleGapsScaled && appearance.itemScaling !== "None") found = of(Math.max(...gaps.map(gap => gap.scale ?? 0)));
  return found;
}

/**
 * Gör detaljgapen fasta: en `SET_CIRCLE_GAPS` per kontroll som får nya avbrott, för varje skala som kontrollens banor
 * och alla kontroller skrivs ut i, med gapen för ringens storlek vid den skalan (målet: den yttre ringen, som Purple Pen
 * klipper båda ringarna lika). Avbrotten som redan gäller vid skalan behålls; övriga skalor rörs inte. Görs som ett steg
 * i editorn (alla ändringar tillsammans), och går fram och tillbaka till Purple Pen som vanliga ringavbrott.
 * `detailGaps` har nycklarna från `detailCircles` (`detailGapKey`); en nyckel som bara är kontrollens id gäller alla storlekar.
 */
export function bakeDetailGapEdits(document: CourseSettingDocument, detailGaps: Readonly<Record<string, readonly Arc[]>>): CourseSettingEdit[] {
  const appearance = appearanceOf(document);
  const scalesOf = printScalesOf(document);
  const edits: CourseSettingEdit[] = [];
  for (const control of Object.values(document.controls)) {
    if (control.kind !== "NORMAL" && control.kind !== "FINISH") continue;
    const id = control.id;
    const byGapScale = new Map<number, readonly Arc[]>();
    for (const printScale of scalesOf(id)) {
      const radius = ringsAt(document, control.kind, printScale).radii[0]!;
      const gaps = detailGaps[detailGapKey(id, radius)] ?? detailGaps[id];
      if (gaps && gaps.length > 0) byGapScale.set(circleGapScale(appearance, printScale, document.event.mapScale), gaps);
    }
    if (byGapScale.size === 0) continue;
    let next: CircleGap[] = (control.circleGaps ?? []).filter(gap => gap.scale === null || !byGapScale.has(gap.scale));
    for (const [scale, gaps] of [...byGapScale].sort((a, b) => a[0] - b[0])) {
      const merged = simplifyGaps([...gapsAtScale(document, control, scale), ...gaps]);
      next = [...next, ...merged.map(arc => ({ scale, startDegrees: round(arc.startDegrees), endDegrees: round(arc.endDegrees) }))];
    }
    if (sameGaps(next, control.circleGaps ?? [])) continue;
    edits.push({ type: "SET_CIRCLE_GAPS", control: id, gaps: next });
  }
  return edits;
}

/** Hundradels grader räcker (Purple Pen sparar float). */
const round = (degrees: number) => Math.round(degrees * 100) / 100;

function sameGaps(a: readonly CircleGap[], b: readonly CircleGap[]): boolean {
  const key = (gaps: readonly CircleGap[]) => JSON.stringify([...gaps].map(g => [g.scale, g.startDegrees, g.endDegrees]).sort());
  return key(a) === key(b);
}
