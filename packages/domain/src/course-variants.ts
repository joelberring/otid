import { createRandom, shuffle } from "./seeded-random";
import type { CourseVariant, CourseVersion, RaceSnapshot } from "./types";

/**
 * Gafflingar (ADR-0169 beslut 2). En banversion kan ha flera varianter med var sin
 * hel kontrollföljd. Klassen pekar på banan och löparen bär sin variants kod.
 * Utan varianter fungerar allt som tidigare. Funktionerna här är rena.
 */
export const COURSE_VARIANT_CODE_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._:/-]{0,31}$/u;

/** Banversionens varianter i visningsordning (tom lista = inte gafflad). */
export function courseVariantsOf(version: CourseVersion): readonly CourseVariant[] {
  return [...(version.variants ?? [])].sort((left, right) => left.sequence - right.sequence ||
    (left.code < right.code ? -1 : left.code > right.code ? 1 : 0));
}

export function isForkedCourseVersion(version: CourseVersion): boolean {
  return (version.variants?.length ?? 0) > 0;
}

/** Varianten med koden, om banversionen har den. */
export function assignedCourseVariant(version: CourseVersion, code: string | undefined | null): CourseVariant | undefined {
  if (code === undefined || code === null) return undefined;
  return version.variants?.find((variant) => variant.code === code);
}

export function courseVariantControlCodes(variant: CourseVariant): number[] {
  return [...variant.controls].sort((left, right) => left.sequence - right.sequence).map((control) => control.controlCode);
}

function versionById(snapshot: RaceSnapshot, courseVersionId: string): CourseVersion | undefined {
  for (const course of snapshot.courses) {
    const version = course.versions.find((candidate) => candidate.id === courseVersionId);
    if (version) return version;
  }
  return undefined;
}

/**
 * Kontrollföljden som löparen ska springa: tilldelad variant, annars banans första
 * variant (gafflad bana utan tilldelning) eller banans egen kontrollföljd.
 */
export function entryCourseControls(snapshot: RaceSnapshot, entryId: string):
  { readonly variantCode?: string; readonly assigned: boolean; readonly controlCodes: readonly number[] } | undefined {
  const entry = snapshot.entries.find((candidate) => candidate.id === entryId);
  const raceClass = entry && snapshot.classes.find((candidate) => candidate.id === entry.classId);
  const version = raceClass && versionById(snapshot, raceClass.courseVersionId);
  if (!entry || !version) return undefined;
  const assigned = assignedCourseVariant(version, entry.courseVariantCode);
  if (assigned) return { variantCode: assigned.code, assigned: true, controlCodes: courseVariantControlCodes(assigned) };
  const first = courseVariantsOf(version)[0];
  if (first) return { variantCode: first.code, assigned: false, controlCodes: courseVariantControlCodes(first) };
  return { assigned: false, controlCodes: [...version.controls].sort((left, right) => left.sequence - right.sequence)
    .map((control) => control.controlCode) };
}

/** Ändpunkt för en sträcka: start, en kontrollkod eller mål. */
export type CourseLegPoint = "START" | "FINISH" | number;

export interface UnevenCourseLeg {
  readonly from: CourseLegPoint;
  readonly to: CourseLegPoint;
  /** Varianterna som har sträckan (en kod per förekomst). */
  readonly variantCodes: readonly string[];
}

function legKey(from: CourseLegPoint, to: CourseLegPoint): string {
  return `${from}>${to}`;
}

/**
 * Gafflingskontroll: varje variant ska innehålla samma sträckor (start–kontroll,
 * kontroll–kontroll och kontroll–mål), lika många gånger, men gärna i olika ordning.
 * Ger sträckorna som inte förekommer lika många gånger i alla varianter. Tom lista =
 * varianterna täcker samma sträckor.
 */
export function unevenCourseVariantLegs(variants: readonly { readonly code: string; readonly controlCodes: readonly number[] }[]): UnevenCourseLeg[] {
  if (variants.length < 2) return [];
  const legs = new Map<string, { from: CourseLegPoint; to: CourseLegPoint; counts: Map<string, number>; order: number }>();
  for (const variant of variants) {
    const points: CourseLegPoint[] = ["START", ...variant.controlCodes, "FINISH"];
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1]!, to = points[index]!;
      const key = legKey(from, to);
      const leg = legs.get(key) ?? { from, to, counts: new Map<string, number>(), order: legs.size };
      leg.counts.set(variant.code, (leg.counts.get(variant.code) ?? 0) + 1);
      legs.set(key, leg);
    }
  }
  const uneven: UnevenCourseLeg[] = [];
  for (const leg of [...legs.values()].sort((left, right) => left.order - right.order)) {
    const counts = variants.map((variant) => leg.counts.get(variant.code) ?? 0);
    if (counts.every((count) => count === counts[0])) continue;
    uneven.push({ from: leg.from, to: leg.to, variantCodes: variants.flatMap((variant) =>
      Array.from({ length: leg.counts.get(variant.code) ?? 0 }, () => variant.code)) });
  }
  return uneven;
}

/** Koden som används minst; vid lika antal den första i variantordningen. */
export function leastUsedCourseVariant(variantCodes: readonly string[], usedCodes: readonly (string | null | undefined)[]): string | undefined {
  let best: { code: string; count: number } | undefined;
  for (const code of variantCodes) {
    const count = usedCodes.filter((used) => used === code).length;
    if (!best || count < best.count) best = { code, count };
  }
  return best?.code;
}

export interface CourseVariantRunner {
  readonly entryId: string;
  /** Nuvarande kod, om löparen har en. En kod som banan inte har räknas som saknad. */
  readonly variantCode: string | null;
  /** Varianten som löparens avläsning passar, om löparen redan läst ut. */
  readonly readoutVariantCode?: string | null;
}

/**
 * Fördelar varianter på löpare som saknar giltig variant, jämnt och deterministiskt
 * med fröet. Löpare som har läst ut får varianten som avläsningen passar (så att
 * resultatet inte ändras). Övriga blandas med fröet och får den minst använda
 * varianten; lika antal avgörs av en lottad variantordning. Ger nya koder per deltagare.
 */
export function distributeCourseVariants(input: {
  readonly seed: number;
  readonly variantCodes: readonly string[];
  readonly runners: readonly CourseVariantRunner[];
}): Map<string, string> {
  const assigned = new Map<string, string>();
  if (input.variantCodes.length === 0) return assigned;
  const valid = new Set(input.variantCodes);
  const counts = new Map(input.variantCodes.map((code) => [code, 0]));
  const sorted = [...input.runners].sort((left, right) => left.entryId < right.entryId ? -1 : left.entryId > right.entryId ? 1 : 0);
  const open: CourseVariantRunner[] = [];
  for (const runner of sorted) {
    if (runner.variantCode !== null && valid.has(runner.variantCode)) {
      counts.set(runner.variantCode, counts.get(runner.variantCode)! + 1);
    } else if (runner.readoutVariantCode && valid.has(runner.readoutVariantCode)) {
      assigned.set(runner.entryId, runner.readoutVariantCode);
      counts.set(runner.readoutVariantCode, counts.get(runner.readoutVariantCode)! + 1);
    } else {
      open.push(runner);
    }
  }
  const random = createRandom(input.seed);
  const order = shuffle(input.variantCodes, random);
  for (const runner of shuffle(open, random)) {
    let best = order[0]!;
    for (const code of order) if (counts.get(code)! < counts.get(best)!) best = code;
    assigned.set(runner.entryId, best);
    counts.set(best, counts.get(best)! + 1);
  }
  return assigned;
}

/** Ögonblicksbilden med löparnas nya varianter (null tar bort varianten). */
export function withProposedEntryVariants(snapshot: RaceSnapshot, variants: ReadonlyMap<string, string | null>): RaceSnapshot {
  return {
    ...snapshot,
    entries: snapshot.entries.map((entry) => {
      if (!variants.has(entry.id)) return entry;
      const code = variants.get(entry.id)!;
      const rest = { ...entry };
      delete (rest as { courseVariantCode?: string }).courseVariantCode;
      return code === null ? rest : { ...rest, courseVariantCode: code };
    })
  };
}

/**
 * Varianten som ett sparat resultat hör till: löparens variant om banversionen har den,
 * annars den variant där flest av sträcktidernas kontroller finns i ordning (vid lika
 * den första). Används för att visa ett gafflat resultat mot rätt kontrollföljd.
 */
export function storedResultCourseVariant<T extends { readonly code: string; readonly controlCodes: readonly number[] }>(
  variants: readonly T[], assignedCode: string | null | undefined, splitCodes: readonly number[]): T | undefined {
  const assigned = variants.find((variant) => variant.code === assignedCode);
  if (assigned) return assigned;
  let best: { variant: T; matched: number } | undefined;
  for (const variant of variants) {
    let index = 0, matched = 0;
    for (const code of splitCodes) {
      const found = variant.controlCodes.indexOf(code, index);
      if (found >= 0) { matched += 1; index = found + 1; }
    }
    if (!best || matched > best.matched) best = { variant, matched };
  }
  return best?.variant;
}
