import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { placeLateEntry } from "@o-tid/domain";
import type { DbExecutor } from "./snapshot";

/**
 * Underlaget för lottningen (PLAN.md steg 9): klasser med banans första kontroll,
 * anmälda och klassernas gällande lottning. Delas av lottningen och av
 * efteranmälan, som placerar en ny löpare på första lediga vakanta tid.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const MAX_ENTRIES = 10_000;

export type DrawBasisClass = {
  id: string; name: string; startRule: "FIXED" | "PUNCH"; startDrawId: string | null;
  courseVersionId: string; courseName: string; firstControlCode: number | null;
};
export type DrawBasisEntry = {
  id: string; classId: string; givenName: string; familyName: string; organisationName: string | null;
  fixedStartTime: Date | null; version: number; courseVariantCode: string | null;
};
export type DrawPlan = {
  classId: string; drawId: string; method: "MINUTE" | "MASS"; firstStartTime: Date; intervalSeconds: number; vacancyCount: number;
  slots: { position: number; startTime: Date; entryId: string | null }[];
};

/**
 * Kod för första kontrollen per banversion (null för en bana utan kontroller). En gafflad
 * bana har sina kontroller i varianterna; första variantens första kontroll gäller.
 */
async function firstControlCodes(tx: DbExecutor, courseVersionIds: readonly string[]): Promise<Map<string, number | null>> {
  const codes = new Map<string, number | null>(courseVersionIds.map(id => [id, null]));
  if (courseVersionIds.length === 0) return codes;
  const rows = await tx.selectDistinctOn([schema.courseControls.courseVersionId], {
    courseVersionId: schema.courseControls.courseVersionId, code: schema.controls.code
  }).from(schema.courseControls).innerJoin(schema.controls, eq(schema.controls.id, schema.courseControls.controlId))
    .where(inArray(schema.courseControls.courseVersionId, [...courseVersionIds]))
    .orderBy(asc(schema.courseControls.courseVersionId), asc(schema.courseControls.sequence));
  for (const row of rows) codes.set(row.courseVersionId, row.code);
  const forked = await tx.select({ courseVersionId: schema.courseVariants.courseVersionId, code: schema.controls.code })
    .from(schema.courseVariants)
    .innerJoin(schema.courseVariantControls, and(eq(schema.courseVariantControls.courseVariantId, schema.courseVariants.id),
      eq(schema.courseVariantControls.sequence, 1)))
    .innerJoin(schema.controls, eq(schema.controls.id, schema.courseVariantControls.controlId))
    .where(inArray(schema.courseVariants.courseVersionId, [...courseVersionIds]))
    .orderBy(asc(schema.courseVariants.courseVersionId), asc(schema.courseVariants.sequence));
  for (const row of forked) if (codes.get(row.courseVersionId) === null) codes.set(row.courseVersionId, row.code);
  return codes;
}

const notRelayClass = sql`not exists (select 1 from relay_leg rl where rl.class_id = ${schema.classes.id})`;

export async function loadDrawClasses(tx: DbExecutor, raceId: string): Promise<DrawBasisClass[]> {
  const rows = await tx.select({ id: schema.classes.id, name: schema.classes.name, startRule: schema.classes.startRule,
    startDrawId: schema.classes.startDrawId, courseVersionId: schema.classes.courseVersionId, courseName: schema.courses.name,
    courseRaceId: schema.courses.raceId }).from(schema.classes)
    .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
    .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
    // Stafettklasser lottas inte: sträckorna har masstart, växling eller omstart (ADR-0169 beslut 3).
    .where(and(eq(schema.classes.raceId, raceId), notRelayClass)).orderBy(asc(schema.classes.name), asc(schema.classes.id)).limit(1_001);
  if (rows.length > 1_000 || rows.some(row => row.courseRaceId !== raceId)) throw new Error("Ogiltigt klassunderlag för lottningen");
  const codes = await firstControlCodes(tx, [...new Set(rows.map(row => row.courseVersionId))]);
  return rows.map(row => ({ id: row.id, name: row.name, startRule: row.startRule, startDrawId: row.startDrawId,
    courseVersionId: row.courseVersionId, courseName: row.courseName, firstControlCode: codes.get(row.courseVersionId) ?? null }));
}

export async function loadDrawEntries(tx: Transaction, raceId: string, lock: boolean): Promise<DrawBasisEntry[] | "too-large"> {
  const query = tx.select({ id: schema.entries.id, classId: schema.entries.classId, givenName: schema.entries.givenName,
    familyName: schema.entries.familyName, organisationName: schema.entries.organisationName,
    fixedStartTime: schema.entries.fixedStartTime, version: schema.entries.version,
    courseVariantCode: schema.entries.courseVariantCode }).from(schema.entries)
    .where(and(eq(schema.entries.raceId, raceId), isNull(schema.entries.teamId))).orderBy(asc(schema.entries.id)).limit(MAX_ENTRIES + 1);
  const rows = lock ? await query.for("update") : await query;
  return rows.length > MAX_ENTRIES ? "too-large" : rows;
}

/** Klassernas gällande lottning (den som klassen pekar på). */
export async function loadDrawPlans(tx: DbExecutor, classes: readonly Pick<DrawBasisClass, "id" | "startDrawId">[]): Promise<Map<string, DrawPlan>> {
  const drawn = classes.filter(row => row.startDrawId !== null);
  const plans = new Map<string, DrawPlan>();
  if (drawn.length === 0) return plans;
  const drawIds = [...new Set(drawn.map(row => row.startDrawId!))];
  const wanted = new Set(drawn.map(row => `${row.startDrawId}:${row.id}`));
  const headers = await tx.select().from(schema.startDrawClasses).where(inArray(schema.startDrawClasses.drawId, drawIds));
  const slots = await tx.select().from(schema.startDrawSlots).where(inArray(schema.startDrawSlots.drawId, drawIds))
    .orderBy(asc(schema.startDrawSlots.position));
  for (const header of headers) {
    if (!wanted.has(`${header.drawId}:${header.classId}`)) continue;
    plans.set(header.classId, { classId: header.classId, drawId: header.drawId, method: header.method,
      firstStartTime: header.firstStartTime, intervalSeconds: header.intervalSeconds, vacancyCount: header.vacancyCount,
      slots: slots.filter(slot => slot.drawId === header.drawId && slot.classId === header.classId)
        .map(slot => ({ position: slot.position, startTime: slot.startTime, entryId: slot.entryId })) });
  }
  if (plans.size !== drawn.length) throw new Error("Klassens lottning saknas");
  return plans;
}

/**
 * Starttid för en efteranmäld i en lottad klass, eller null om klassen inte är lottad.
 * Anroparen håller tävlingens skrivlås.
 */
export async function assignLateStartTime(tx: Transaction, raceId: string, classId: string, now: Date): Promise<Date | null> {
  const classes = await loadDrawClasses(tx, raceId);
  const target = classes.find(row => row.id === classId);
  if (!target || target.startRule !== "FIXED" || target.startDrawId === null) return null;
  const group = target.firstControlCode === null ? [target]
    : classes.filter(row => row.startRule === "FIXED" && row.firstControlCode === target.firstControlCode);
  const plans = await loadDrawPlans(tx, group);
  const plan = plans.get(target.id)!;
  const entries = await tx.select({ classId: schema.entries.classId, fixedStartTime: schema.entries.fixedStartTime })
    .from(schema.entries).where(and(eq(schema.entries.raceId, raceId), inArray(schema.entries.classId, group.map(row => row.id))));
  const times = (rows: readonly { fixedStartTime: Date | null }[]) => rows.flatMap(row => row.fixedStartTime ? [row.fixedStartTime.getTime()] : []);
  const others = group.filter(row => row.id !== target.id).map(row => row.id);
  const time = placeLateEntry({ method: plan.method, firstStartMs: plan.firstStartTime.getTime(), intervalMinutes: plan.intervalSeconds / 60,
    slotTimesMs: plan.slots.map(slot => slot.startTime.getTime()),
    classTimesMs: times(entries.filter(row => row.classId === target.id)),
    groupTimesMs: [...times(entries.filter(row => others.includes(row.classId))),
      ...others.flatMap(id => plans.get(id)?.slots.map(slot => slot.startTime.getTime()) ?? [])],
    nowMs: now.getTime() });
  return new Date(time);
}

export type StartListFacts = { firstControlCode: number | null; drawMethod: "MINUTE" | "MASS" | null; vacancies: string[] };

/**
 * Startlistornas fakta per individuell klass (PLAN.md steg 13): banans första kontroll (startfållan),
 * lottningens startsätt och vakanta tider. En lottad tid är vakant när ingen i klassen har den.
 */
export async function loadStartListFacts(tx: DbExecutor, raceId: string): Promise<Map<string, StartListFacts>> {
  const classes = await loadDrawClasses(tx, raceId);
  const plans = await loadDrawPlans(tx, classes);
  const taken = new Map<string, Set<number>>();
  if (plans.size > 0) {
    const rows = await tx.select({ classId: schema.entries.classId, fixedStartTime: schema.entries.fixedStartTime }).from(schema.entries)
      .where(and(eq(schema.entries.raceId, raceId), inArray(schema.entries.classId, [...plans.keys()])));
    for (const row of rows) {
      if (row.fixedStartTime) taken.set(row.classId, (taken.get(row.classId) ?? new Set()).add(row.fixedStartTime.getTime()));
    }
  }
  return new Map(classes.map(row => {
    const plan = row.startRule === "FIXED" ? plans.get(row.id) : undefined;
    const used = taken.get(row.id) ?? new Set<number>();
    return [row.id, { firstControlCode: row.firstControlCode, drawMethod: plan?.method ?? null,
      vacancies: plan?.method === "MINUTE" ? plan.slots.filter(slot => !used.has(slot.startTime.getTime()))
        .map(slot => slot.startTime.toISOString()) : [] }];
  }));
}
