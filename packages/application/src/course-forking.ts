import { inArray } from "drizzle-orm";
import { courseForkingSchema } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  deriveCourseForking, forkingChoicesFor, forkingPointCount, generateForkingVariants, validateCourseForking,
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
  /** Gammal kod → ny kod för samma kontrollföljd; null = kontrollföljden försvinner. */
  readonly codeMap: ReadonlyMap<string, string | null>;
  readonly removedCodes: readonly string[];
}

const sequenceKey = (codes: readonly number[]) => codes.join(" ");

/**
 * Planen när en struktur sparas: varianterna genereras, en variant med samma kontrollföljd som förut behåller längden
 * och löparna (under den nya koden), och koder vars kontrollföljd försvinner listas. Undefined när strukturen bryter
 * mot reglerna. En struktur utan gafflingspunkter blir en vanlig bana.
 */
export function planForkingSave(current: readonly StoredCourseVariant[], forking: CourseForking): ForkingSavePlan | undefined {
  if (validateCourseForking(forking).length > 0) return undefined;
  const generated = generateForkingVariants(forking);
  const bySequence = new Map(current.map(variant => [sequenceKey(variant.controlCodes), variant]));
  const kept = new Set(generated.map(variant => sequenceKey(variant.controlCodes)));
  const variants = generated.map(variant => {
    const previous = bySequence.get(sequenceKey(variant.controlCodes));
    return { code: variant.code, controlCodes: variant.controlCodes, lengthMeters: previous?.lengthMeters ?? null, previousCode: previous?.code ?? null };
  });
  const codeMap = new Map<string, string | null>();
  for (const variant of current) {
    const next = variants.find(candidate => candidate.previousCode === variant.code);
    codeMap.set(variant.code, next ? next.code : null);
  }
  const plain = forkingPointCount(forking) === 0;
  return { forking: plain ? null : forking, variants: plain ? [] : variants,
    controlCodes: plain ? forking.items.flatMap(item => item.kind === "CONTROL" ? [item.code] : []) : [],
    codeMap, removedCodes: current.filter(variant => !kept.has(sequenceKey(variant.controlCodes))).map(variant => variant.code) };
}
