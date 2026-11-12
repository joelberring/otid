import {
  deriveCourseForking, forkingChoicesFor, forkingLetters, forkingVariantCode, type CourseForking, type ForkingChoice, type ForkingItem
} from "./course-forking";

/**
 * Bokstäverna som identitet när en gafflad banas struktur sparas om (ADR-0175 beslut 3, tillägg 2026-11-12 b). Kartorna är
 * ofta redan tryckta med variantkoden, så en bokstav ska betyda samma alternativ i programmet som på kartan:
 *
 * - Ett alternativ behåller sin bokstav när ett annat alternativ eller en hel gafflingspunkt tas bort (A, C med lucka).
 * - Ett nytt alternativ får nästa lediga bokstav som aldrig har använts på banan (`retiredLetters`).
 * - Löparens nya kod är löparens gamla bokstäver i de gafflingspunkter som finns kvar. Bara den vars egen bokstav
 *   försvinner (eller som saknar bokstav i en ny gafflingspunkt) får en ny variant.
 */

const sequenceKey = (codes: readonly number[]) => codes.join(" ");
const branchesOf = (item: ForkingItem): readonly (readonly number[])[] =>
  item.kind === "FORK" ? item.branches : item.kind === "LOOP" ? item.loops : [];
const withLetters = (item: ForkingItem, letters: readonly (string | null)[]): ForkingItem =>
  item.kind === "CONTROL" ? item : { ...item, letters: [...letters] };

/** Strukturen med varje bokstav utskriven (saknade och null fylls i som `forkingLetters`) och de använda bokstäverna sorterade. */
export function withExplicitForkingLetters(forking: CourseForking): CourseForking {
  const letters = forkingLetters(forking);
  const retired = [...new Set(forking.retiredLetters ?? [])].sort();
  return { items: forking.items.map((item, index) => withLetters(item, letters[index] ?? [])), ...(retired.length > 0 ? { retiredLetters: retired } : {}) };
}

const hasLetters = (forking: CourseForking) => forking.items.some((item) => item.kind !== "CONTROL" && item.letters !== undefined);

interface Point { readonly index: number; readonly ordinal: number; readonly item: ForkingItem }
const pointsOf = (forking: CourseForking): Point[] => forking.items.flatMap((item, index) => item.kind === "CONTROL" ? [] : [{ index, item }])
  .map((point, ordinal) => ({ ...point, ordinal }));

/** Hur lika två gafflingspunkter är: samma alternativ väger tyngst, sedan samma mittkontroll och gemensamma kontroller. */
function similarity(left: ForkingItem, right: ForkingItem): number {
  if (left.kind !== right.kind) return 0;
  const leftKeys = new Set(branchesOf(left).map(sequenceKey));
  const same = branchesOf(right).filter((branch) => leftKeys.has(sequenceKey(branch))).length;
  const leftCodes = new Set(branchesOf(left).flat());
  const shared = new Set(branchesOf(right).flat().filter((code) => leftCodes.has(code))).size;
  const center = left.kind === "LOOP" && right.kind === "LOOP" && left.center === right.center ? 100 : 0;
  return same * 1000 + center + shared;
}

/**
 * Bokstäverna för en struktur som skickats utan bokstäver (äldre klient, API): gafflingspunkterna paras med de gamla efter
 * likhet (annars i ordning när antalet är detsamma). Inom ett par får ett alternativ med samma kontroller som förut den
 * gamla bokstaven; är lika många alternativ kvar utan par på båda sidor paras de i ordning (rättade kontrollkoder),
 * annars blir de nya alternativen nya (null) och de gamla bokstäverna tas bort.
 */
function inferredLetters(before: CourseForking, next: CourseForking): CourseForking {
  const oldPoints = pointsOf(before), newPoints = pointsOf(next);
  const oldLetters = forkingLetters(before);
  const pairs = oldPoints.flatMap((old) => newPoints.map((fresh) => ({ old, fresh, score: similarity(old.item, fresh.item) })))
    .filter((pair) => pair.score > 0)
    .sort((left, right) => right.score - left.score || Math.abs(left.old.ordinal - left.fresh.ordinal) - Math.abs(right.old.ordinal - right.fresh.ordinal));
  const matched = new Map<number, Point>();
  const usedOld = new Set<number>();
  for (const pair of pairs) {
    if (matched.has(pair.fresh.index) || usedOld.has(pair.old.index)) continue;
    matched.set(pair.fresh.index, pair.old);
    usedOld.add(pair.old.index);
  }
  if (oldPoints.length === newPoints.length) {
    for (const [ordinal, fresh] of newPoints.entries()) {
      const old = oldPoints[ordinal]!;
      if (!matched.has(fresh.index) && !usedOld.has(old.index) && old.item.kind === fresh.item.kind) {
        matched.set(fresh.index, old);
        usedOld.add(old.index);
      }
    }
  }
  return { items: next.items.map((item, index) => {
    if (item.kind === "CONTROL") return item;
    const branches = branchesOf(item);
    const old = matched.get(index);
    if (!old) return withLetters(item, branches.map(() => null));
    const own = oldLetters[old.index] ?? [];
    const oldKeys = branchesOf(old.item).map(sequenceKey);
    const letters: (string | null)[] = branches.map(() => null);
    const takenOld = new Set<number>();
    branches.forEach((branch, position) => {
      const found = oldKeys.findIndex((key, oldIndex) => key === sequenceKey(branch) && !takenOld.has(oldIndex));
      if (found >= 0) { letters[position] = own[found] ?? null; takenOld.add(found); }
    });
    const openNew = letters.flatMap((letter, position) => letter === null ? [position] : []);
    const openOld = oldKeys.flatMap((_key, oldIndex) => takenOld.has(oldIndex) ? [] : [oldIndex]);
    if (openNew.length === openOld.length) openNew.forEach((position, step) => { letters[position] = own[openOld[step]!] ?? null; });
    return withLetters(item, letters);
  }) };
}

/**
 * Den nya strukturens bokstäver när den sparas över `previous` (null = banan hade ingen gaffling). Bokstäver som följer
 * med i begäran gäller (editorn bär dem med alternativen); en struktur helt utan bokstäver får dem genom att paras med den
 * gamla. Gamla bokstäver som inte är kvar blir `retiredLetters`, och en sådan bokstav i begäran räknas som ett nytt
 * alternativ (null), så att en bokstav som en löpare kan ha på kartan aldrig får ett annat innehåll. Ger alltid en struktur
 * med varje bokstav utskriven.
 */
export function withAssignedForkingLetters(previous: CourseForking | null | undefined, next: CourseForking): CourseForking {
  if (!previous) return withExplicitForkingLetters({ items: next.items });
  const before = withExplicitForkingLetters(previous);
  const proposal = hasLetters(next) ? next : inferredLetters(before, next);
  const previousLetters = new Set(forkingLetters(before).flatMap((letters) => letters ?? []));
  const retiredBefore = new Set(before.retiredLetters ?? []);
  const items = proposal.items.map((item) => item.kind === "CONTROL" || item.letters === undefined ? item
    : withLetters(item, item.letters.map((letter) => letter !== null && retiredBefore.has(letter) && !previousLetters.has(letter) ? null : letter)));
  const kept = new Set(items.flatMap((item) => item.kind === "CONTROL" ? [] : (item.letters ?? []).filter((letter): letter is string => letter !== null)));
  const retired = [...new Set([...retiredBefore, ...previousLetters])].filter((letter) => !kept.has(letter));
  return withExplicitForkingLetters({ items, retiredLetters: retired });
}

export interface ForkingCodedVariant { readonly code: string; readonly controlCodes: readonly number[] }

/** Den nya gafflingspunkten som motsvarar en gammal: samma slag och flest gemensamma bokstäver. */
function correspondingPoints(before: CourseForking, after: CourseForking): Map<number, number> {
  const beforeLetters = forkingLetters(before), afterLetters = forkingLetters(after);
  const pairs = pointsOf(after).flatMap((fresh) => pointsOf(before).map((old) => ({ fresh: fresh.index, old: old.index,
    shared: old.item.kind !== fresh.item.kind ? 0 : (afterLetters[fresh.index] ?? []).filter((letter) => (beforeLetters[old.index] ?? []).includes(letter)).length })))
    .filter((pair) => pair.shared > 0).sort((left, right) => right.shared - left.shared);
  const result = new Map<number, number>();
  const usedOld = new Set<number>();
  for (const pair of pairs) {
    if (result.has(pair.fresh) || usedOld.has(pair.old)) continue;
    result.set(pair.fresh, pair.old);
    usedOld.add(pair.old);
  }
  return result;
}

/** Löparens val i den nya strukturen med samma bokstäver som i den gamla, eller undefined när en bokstav saknas. */
function translatedChoices(before: CourseForking, after: CourseForking, choices: readonly ForkingChoice[],
  points: ReadonlyMap<number, number>): ForkingChoice[] | undefined {
  const beforeLetters = forkingLetters(before), afterLetters = forkingLetters(after);
  const result: ForkingChoice[] = [];
  for (const [index, item] of after.items.entries()) {
    if (item.kind === "CONTROL") { result.push(null); continue; }
    const old = points.get(index);
    if (old === undefined) return undefined;
    const own = beforeLetters[old] ?? [], fresh = afterLetters[index] ?? [];
    const choice = choices[old];
    if (item.kind === "FORK") {
      const position = fresh.indexOf(own[typeof choice === "number" ? choice : 0] ?? "");
      if (position < 0) return undefined;
      result.push(position);
    } else {
      const order: readonly number[] = Array.isArray(choice) ? choice as readonly number[] : own.map((_letter, position) => position);
      const ran = order.map((position) => own[position] ?? "");
      if (fresh.some((letter) => !ran.includes(letter))) return undefined;
      result.push(ran.filter((letter) => fresh.includes(letter)).map((letter) => fresh.indexOf(letter)));
    }
  }
  return result;
}

/**
 * Löparnas variantkoder när en gafflad banas struktur sparas om (ADR-0175 beslut 3, tillägg 2026-11-12 och 2026-11-12 b).
 * Bokstaven är alternativets identitet: löparen behåller sina bokstäver i de gafflingspunkter som finns kvar (ett rättat
 * alternativ ger samma kod med nya kontroller; en borttagen gafflingspunkts bokstav faller bort, "AC" blir "C"). Null när
 * löparens bokstav i en kvarvarande punkt tas bort, när en ny gafflingspunkt tillkommer eller när koden inte sparas
 * (bortvald variant): anroparen ger då en ny variant.
 *
 * En gammal variant vars kod inte är strukturens kod för samma val (banfil med egna koder) följer bara sin kontrollföljd.
 * `previous.forking` saknas för varianter från en banfil utan sparad struktur; då jämförs med den härledda strukturen.
 * `next.forking` null = banan blir en vanlig bana utan varianter.
 */
export function forkingVariantCodeMap(previous: { readonly forking?: CourseForking | null | undefined; readonly variants: readonly ForkingCodedVariant[] },
  next: { readonly forking: CourseForking | null; readonly variants: readonly ForkingCodedVariant[] }): Map<string, string | null> {
  const result = new Map<string, string | null>();
  const nextBySequence = new Map(next.variants.map((variant) => [sequenceKey(variant.controlCodes), variant.code]));
  const bySequence = (variant: ForkingCodedVariant) => nextBySequence.get(sequenceKey(variant.controlCodes)) ?? null;
  if (!next.forking || previous.variants.length === 0) {
    for (const variant of previous.variants) result.set(variant.code, bySequence(variant));
    return result;
  }
  const derived = previous.forking ? undefined : deriveCourseForking(previous.variants);
  const before = previous.forking ?? derived!.forking;
  const after = next.forking;
  const points = correspondingPoints(before, after);
  const nextCodes = new Set(next.variants.map((variant) => variant.code));
  for (const variant of previous.variants) {
    const choices = derived ? derived.choices.get(variant.code) : forkingChoicesFor(before, variant.controlCodes);
    if (!choices || forkingVariantCode(before, choices) !== variant.code) { result.set(variant.code, bySequence(variant)); continue; }
    const translated = translatedChoices(before, after, choices, points);
    const code = translated ? forkingVariantCode(after, translated) : undefined;
    result.set(variant.code, code !== undefined && nextCodes.has(code) ? code : null);
  }
  return result;
}
