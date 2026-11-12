import { inArray } from "drizzle-orm";
import { courseForkingSchema } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  deriveCourseForking, forkingChoicesFor, forkingPointCount, forkingVariantCodeMap, generateForkingVariants, validateCourseForking,
  type CourseForking, type ForkingChoice, type ForkingItem
} from "@o-tid/domain";
import type { StoredCourseVariant } from "./course-variants";

/**
 * Gafflingsstrukturen i applikationslagret (steg 49, ADR-0175): läsa sparade strukturer, bilden för en banas varianter
 * (sparad struktur, annars härledd ur varianterna) och planen när en ny struktur sparas.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

/** Sparade strukturer per banversion (banversioner utan struktur saknas i kartan). */
export async function loadCourseVersionForking(tx: Executor, courseVersionIds: readonly string[]): Promise<Map<string, CourseForking>> {
  const result = new Map<string, CourseForking>();
  if (courseVersionIds.length === 0) return result;
  const rows = await tx.select({ id: schema.courseVersions.id, forking: schema.courseVersions.forking }).from(schema.courseVersions)
    .where(inArray(schema.courseVersions.id, [...new Set(courseVersionIds)]));
  for (const row of rows) {
    const parsed = row.forking === null ? undefined : courseForkingSchema.safeParse(row.forking);
    if (parsed?.success) result.set(row.id, parsed.data);
  }
  return result;
}

export interface CourseForkingListView {
  readonly items: readonly ForkingItem[];
  readonly variants: readonly { readonly code: string; readonly choices: readonly ForkingChoice[]; readonly lengthMeters: number | null }[];
  readonly stored: boolean;
  readonly convertible: boolean;
  readonly addedCount: number;
}

/**
 * Bilden för en gafflad banas varianter: den sparade strukturen när varje variant är en väg i den, annars en struktur
 * härledd ur varianterna (som alltid ger varje variant som en väg). Undefined för en bana utan varianter.
 */
export function courseForkingView(variants: readonly StoredCourseVariant[], stored: CourseForking | undefined): CourseForkingListView | undefined {
  if (variants.length === 0) return undefined;
  if (stored) {
    const choices = variants.map(variant => forkingChoicesFor(stored, variant.controlCodes));
    if (choices.every(choice => choice !== undefined)) {
      return { items: stored.items, stored: true, convertible: false, addedCount: 0,
        variants: variants.map((variant, index) => ({ code: variant.code, choices: choices[index]!, lengthMeters: variant.lengthMeters ?? null })) };
    }
  }
  const derived = deriveCourseForking(variants);
  if (derived.forking.items.length === 0) return undefined;
  return { items: derived.forking.items, stored: false, convertible: derived.convertible, addedCount: derived.addedCount,
    variants: variants.map(variant => ({ code: variant.code, choices: derived.choices.get(variant.code) ?? [],
      lengthMeters: variant.lengthMeters ?? null })) };
}

export interface ForkingSavePlan {
  readonly forking: CourseForking | null;
  /** Banans egen kontrollföljd (bara när strukturen saknar gafflingspunkter). */
  readonly controlCodes: readonly number[];
  readonly variants: readonly (StoredCourseVariant & { readonly previousCode: string | null })[];
  /**
   * Gammal kod → löparens nya kod (`forkingVariantCodeMap`, tillägg 2026-11-12 i ADR-0175): samma kontrollföljd under
   * ny kod, annars samma kod när den finns kvar (rättad kontrollkod); null = koden försvinner och löparen får ny variant.
   */
  readonly codeMap: ReadonlyMap<string, string | null>;
  /** Stafettsträckor (oförändrat): gammal kod → ny kod för samma kontrollföljd; null = kontrollföljden försvinner. */
  readonly sequenceCodeMap: ReadonlyMap<string, string | null>;
  /** Koder som försvinner (`codeMap` ger null): löparna på dem får en ny variant. */
  readonly removedCodes: readonly string[];
  /** Koder som finns kvar med ändrade kontroller (rättad kontrollkod): löparna behåller koden. */
  readonly changedCodes: readonly string[];
  /** ADR-0198: varianter som strukturen ger men som är bortvalda (samma kod och kontroller) och inte sparas. */
  readonly excludedCodes: readonly string[];
  /** ADR-0198: bortval som inte längre stämmer med någon variant (strukturen har ändrats); de följer med men gäller inte. */
  readonly staleExcludedCodes: readonly string[];
}

/** ADR-0198: en bortvald variant (banläggningen), som den sparas med banversionen. */
export interface ExcludedCourseVariant { readonly code: string; readonly controlCodes: readonly number[] }

const sequenceKey = (codes: readonly number[]) => codes.join(" ");

/**
 * Planen när en struktur sparas: varianterna genereras, en variant med samma kontrollföljd som förut behåller längden,
 * löparnas koder följer `forkingVariantCodeMap` och koder som försvinner listas. Undefined när strukturen bryter mot
 * reglerna. En struktur utan gafflingspunkter blir en vanlig bana. `currentForking` är den sparade strukturen (saknas
 * den jämförs med strukturen härledd ur varianterna).
 */
export function planForkingSave(current: readonly StoredCourseVariant[], forking: CourseForking,
  excluded: readonly ExcludedCourseVariant[] = [], currentForking?: CourseForking): ForkingSavePlan | undefined {
  if (validateCourseForking(forking).length > 0) return undefined;
  const all = generateForkingVariants(forking);
  // ADR-0198: en bortvald variant kommer aldrig tillbaka i tävlingen (samma kod och kontroller). Minst en variant blir kvar.
  const isExcluded = (variant: { code: string; controlCodes: readonly number[] }) =>
    excluded.some(row => row.code === variant.code && sequenceKey(row.controlCodes) === sequenceKey(variant.controlCodes));
  const filtered = all.filter(variant => !isExcluded(variant));
  const generated = filtered.length > 0 ? filtered : all;
  const excludedCodes = filtered.length > 0 ? all.filter(isExcluded).map(variant => variant.code) : [];
  const staleExcludedCodes = forkingPointCount(forking) === 0 ? excluded.map(row => row.code)
    : excluded.filter(row => !all.some(variant => variant.code === row.code && sequenceKey(variant.controlCodes) === sequenceKey(row.controlCodes)))
      .map(row => row.code);
  const bySequence = new Map(current.map(variant => [sequenceKey(variant.controlCodes), variant]));
  const variants = generated.map(variant => {
    const previous = bySequence.get(sequenceKey(variant.controlCodes));
    return { code: variant.code, controlCodes: variant.controlCodes, lengthMeters: previous?.lengthMeters ?? null, previousCode: previous?.code ?? null };
  });
  const sequenceCodeMap = new Map<string, string | null>();
  for (const variant of current) {
    const next = variants.find(candidate => candidate.previousCode === variant.code);
    sequenceCodeMap.set(variant.code, next ? next.code : null);
  }
  const plain = forkingPointCount(forking) === 0;
  const codeMap = forkingVariantCodeMap({ forking: currentForking ?? null, variants: current },
    { forking: plain ? null : forking, variants: plain ? [] : variants });
  return { forking: plain ? null : forking, variants: plain ? [] : variants,
    controlCodes: plain ? forking.items.flatMap(item => item.kind === "CONTROL" ? [item.code] : []) : [],
    codeMap, sequenceCodeMap, removedCodes: current.filter(variant => codeMap.get(variant.code) === null).map(variant => variant.code),
    changedCodes: current.filter(variant => codeMap.get(variant.code) === variant.code && sequenceCodeMap.get(variant.code) !== variant.code)
      .map(variant => variant.code),
    excludedCodes: plain ? [] : excludedCodes, staleExcludedCodes };
}
