import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import {
  courseVariantForReadout, distributeCourseVariants, leastUsedCourseVariant, storedResultCourseVariant, type RaceSnapshot
} from "@o-tid/domain";
import { normalizedReadout } from "./result-reassessment";

/**
 * Gafflingar i applikationslagret (ADR-0169 beslut 2): läsa och spara banversioners
 * varianter och ge löpare en variant (efteranmälan, klassbyte, lottning, "Fördela gafflingar").
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Läsning och sparande av varianter fungerar både i och utanför en transaktion (importen). */
type Executor = Database | Transaction;

export interface StoredCourseVariant {
  readonly code: string;
  readonly controlCodes: readonly number[];
}

/** Varianterna per banversion i visningsordning (banversioner utan varianter saknas i kartan). */
export async function loadCourseVersionVariants(tx: Executor, courseVersionIds: readonly string[]): Promise<Map<string, StoredCourseVariant[]>> {
  const result = new Map<string, StoredCourseVariant[]>();
  if (courseVersionIds.length === 0) return result;
  const variants = await tx.select({ id: schema.courseVariants.id, courseVersionId: schema.courseVariants.courseVersionId,
    code: schema.courseVariants.code }).from(schema.courseVariants)
    .where(inArray(schema.courseVariants.courseVersionId, [...new Set(courseVersionIds)]))
    .orderBy(asc(schema.courseVariants.courseVersionId), asc(schema.courseVariants.sequence));
  if (variants.length === 0) return result;
  const controls = await tx.select({ variantId: schema.courseVariantControls.courseVariantId, code: schema.controls.code })
    .from(schema.courseVariantControls).innerJoin(schema.controls, eq(schema.controls.id, schema.courseVariantControls.controlId))
    .where(inArray(schema.courseVariantControls.courseVariantId, variants.map(row => row.id)))
    .orderBy(asc(schema.courseVariantControls.courseVariantId), asc(schema.courseVariantControls.sequence));
  for (const variant of variants) {
    const list = result.get(variant.courseVersionId) ?? [];
    list.push({ code: variant.code, controlCodes: controls.filter(row => row.variantId === variant.id).map(row => row.code) });
    result.set(variant.courseVersionId, list);
  }
  return result;
}

async function controlId(tx: Executor, raceId: string, code: number): Promise<string> {
  await tx.insert(schema.controls).values({ raceId, code }).onConflictDoNothing();
  const [control] = await tx.select({ id: schema.controls.id }).from(schema.controls)
    .where(and(eq(schema.controls.raceId, raceId), eq(schema.controls.code, code)));
  if (!control) throw new Error(`Kontroll ${code} kunde inte sparas`);
  return control.id;
}

/** Sparar banversionens kontrollföljd (tom för en gafflad bana) och dess varianter. */
export async function insertCourseVersionControls(tx: Executor, raceId: string, courseVersionId: string,
  controlCodes: readonly number[], variants: readonly StoredCourseVariant[] = []): Promise<void> {
  for (const [index, code] of controlCodes.entries()) {
    await tx.insert(schema.courseControls).values({ courseVersionId, controlId: await controlId(tx, raceId, code), sequence: index + 1 });
  }
  for (const [variantIndex, variant] of variants.entries()) {
    const [saved] = await tx.insert(schema.courseVariants).values({ courseVersionId, code: variant.code, sequence: variantIndex + 1 })
      .returning({ id: schema.courseVariants.id });
    if (!saved) throw new Error("Varianten kunde inte sparas");
    for (const [index, code] of variant.controlCodes.entries()) {
      await tx.insert(schema.courseVariantControls).values({ courseVariantId: saved.id, controlId: await controlId(tx, raceId, code),
        sequence: index + 1 });
    }
  }
}

/** Varianternas koder för klassens bana (tom = klassen är inte gafflad). */
export async function classVariantCodes(tx: Transaction, raceId: string, classId: string): Promise<string[]> {
  const rows = await tx.select({ code: schema.courseVariants.code }).from(schema.classes)
    .innerJoin(schema.courseVariants, eq(schema.courseVariants.courseVersionId, schema.classes.courseVersionId))
    .where(and(eq(schema.classes.id, classId), eq(schema.classes.raceId, raceId))).orderBy(asc(schema.courseVariants.sequence));
  return rows.map(row => row.code);
}

/** Efteranmäld i en gafflad klass får den minst använda varianten; annars ingen. Anroparen håller skrivlåset. */
export async function leastUsedVariantForClass(tx: Transaction, raceId: string, classId: string): Promise<string | null> {
  const codes = await classVariantCodes(tx, raceId, classId);
  if (codes.length === 0) return null;
  const used = await tx.select({ code: schema.entries.courseVariantCode }).from(schema.entries)
    .where(and(eq(schema.entries.raceId, raceId), eq(schema.entries.classId, classId)));
  return leastUsedCourseVariant(codes, used.map(row => row.code)) ?? null;
}

/**
 * Variant efter klassbyte: koden behålls om nya klassens bana har den. Annars får en
 * löpare som inte läst ut den minst använda varianten, och en avläst löpare ingen
 * (avläsningen bedöms då mot den variant som stämplingarna passar).
 */
export async function variantAfterClassChange(tx: Transaction, raceId: string, entryId: string, targetClassId: string,
  currentCode: string | null): Promise<string | null> {
  const codes = await classVariantCodes(tx, raceId, targetClassId);
  if (codes.length === 0) return null;
  if (currentCode !== null && codes.includes(currentCode)) return currentCode;
  const [readout] = await tx.select({ id: schema.cardReadouts.id }).from(schema.cardAssignments)
    .innerJoin(schema.cardReadouts, and(eq(schema.cardReadouts.raceId, schema.cardAssignments.raceId),
      eq(schema.cardReadouts.cardNumber, schema.cardAssignments.cardNumber)))
    .where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.entryId, entryId),
      eq(schema.cardAssignments.active, true))).limit(1);
  if (readout) return null;
  return leastUsedVariantForClass(tx, raceId, targetClassId);
}

type Readout = typeof schema.cardReadouts.$inferSelect;

/** Senaste avläsningen per deltagare med exakt en aktiv bricka. */
async function latestReadouts(tx: Transaction, raceId: string, entryIds: readonly string[]): Promise<Map<string, Readout>> {
  const result = new Map<string, Readout>();
  if (entryIds.length === 0) return result;
  const assignments = await tx.select({ entryId: schema.cardAssignments.entryId, cardNumber: schema.cardAssignments.cardNumber })
    .from(schema.cardAssignments).where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.active, true),
      inArray(schema.cardAssignments.entryId, [...entryIds])));
  const cards = new Map<string, string[]>();
  for (const row of assignments) cards.set(row.entryId, [...cards.get(row.entryId) ?? [], row.cardNumber]);
  const single = [...cards.entries()].filter(([, list]) => list.length === 1).map(([entryId, list]) => ({ entryId, card: list[0]! }));
  if (single.length === 0) return result;
  const latestByCard = new Map<string, Readout>();
  for (const row of await tx.select().from(schema.cardReadouts).where(and(eq(schema.cardReadouts.raceId, raceId),
    inArray(schema.cardReadouts.cardNumber, single.map(entry => entry.card))))) {
    const previous = latestByCard.get(row.cardNumber);
    if (!previous || row.readAt > previous.readAt || (row.readAt.getTime() === previous.readAt.getTime() && row.id > previous.id)) {
      latestByCard.set(row.cardNumber, row);
    }
  }
  for (const row of single) {
    const readout = latestByCard.get(row.card);
    if (readout) result.set(row.entryId, readout);
  }
  return result;
}

/**
 * Planerar varianter för klassernas löpare som saknar giltig variant (lottningen och
 * "Fördela gafflingar"). Avlästa löpare får varianten som avläsningen passar, övriga
 * fördelas jämnt med fröet. Ger nya koder per deltagare; klasser utan varianter hoppas över.
 */
export async function planVariantDistribution(tx: Transaction, raceId: string, classIds: readonly string[], seed: number,
  snapshot: RaceSnapshot): Promise<Map<string, string>> {
  const planned = new Map<string, string>();
  for (const [index, classId] of [...classIds].sort().entries()) {
    const codes = await classVariantCodes(tx, raceId, classId);
    if (codes.length === 0) continue;
    const entries = await tx.select({ id: schema.entries.id, code: schema.entries.courseVariantCode }).from(schema.entries)
      .where(and(eq(schema.entries.raceId, raceId), eq(schema.entries.classId, classId)));
    const open = entries.filter(row => row.code === null || !codes.includes(row.code)).map(row => row.id);
    const readouts = await latestReadouts(tx, raceId, open);
    const runners = entries.map(row => {
      const readout = readouts.get(row.id);
      const detected = readout ? courseVariantForReadout(normalizedReadout(readout), snapshot) : undefined;
      return { entryId: row.id, variantCode: row.code, ...(detected ? { readoutVariantCode: detected.code } : {}) };
    });
    // Varje klass får ett eget frö ur lottningens frö så att klassernas fördelningar är oberoende.
    const classSeed = ((seed + index * 2_654_435_761) % 4_294_967_295) + 1;
    for (const [entryId, code] of distributeCourseVariants({ seed: classSeed, variantCodes: codes, runners })) planned.set(entryId, code);
  }
  return planned;
}

/** Sparar planerade varianter. Ökar deltagarens version; anroparen ökar tävlingens version. */
export async function writeEntryVariants(tx: Transaction, raceId: string, planned: ReadonlyMap<string, string | null>): Promise<void> {
  for (const [entryId, code] of planned) {
    const [entry] = await tx.select({ version: schema.entries.version }).from(schema.entries)
      .where(and(eq(schema.entries.id, entryId), eq(schema.entries.raceId, raceId)));
    if (!entry) throw new Error("Deltagaren saknas");
    if (entry.version >= 2_147_483_647) throw new Error("Deltagarens version är slut");
    await tx.update(schema.entries).set({ courseVariantCode: code, version: entry.version + 1 })
      .where(and(eq(schema.entries.id, entryId), eq(schema.entries.raceId, raceId), eq(schema.entries.version, entry.version)));
  }
}

/**
 * Kontrollföljden som ett sparat resultat på en gafflad banversion visas mot: löparens
 * variant, annars varianten som sträcktiderna passar. Undefined för banor utan varianter.
 */
export async function storedResultVariantControls(tx: Executor, courseVersionId: string, entryCode: string | null,
  splitCodes: readonly number[]) {
  const variants = await tx.select({ id: schema.courseVariants.id, code: schema.courseVariants.code }).from(schema.courseVariants)
    .where(eq(schema.courseVariants.courseVersionId, courseVersionId)).orderBy(asc(schema.courseVariants.sequence));
  if (variants.length === 0) return undefined;
  const rows = await tx.select({ id: schema.courseVariantControls.id, variantId: schema.courseVariantControls.courseVariantId,
    sequence: schema.courseVariantControls.sequence, controlCode: schema.controls.code, controlRaceId: schema.controls.raceId })
    .from(schema.courseVariantControls).innerJoin(schema.controls, eq(schema.controls.id, schema.courseVariantControls.controlId))
    .where(inArray(schema.courseVariantControls.courseVariantId, variants.map(variant => variant.id)))
    .orderBy(asc(schema.courseVariantControls.courseVariantId), asc(schema.courseVariantControls.sequence));
  const withControls = variants.map(variant => {
    const controls = rows.filter(row => row.variantId === variant.id);
    return { code: variant.code, controls, controlCodes: controls.map(row => row.controlCode) };
  });
  const chosen = storedResultCourseVariant(withControls, entryCode, splitCodes)!;
  return { code: chosen.code, controls: chosen.controls.map(({ id, sequence, controlCode, controlRaceId }) => ({ id, sequence, controlCode, controlRaceId })) };
}
