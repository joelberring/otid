import { and, asc, eq, inArray } from "drizzle-orm";
import type { StartListImport } from "@o-tid/iof-xml";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { requireImportClasses } from "./import-class-match";

export interface StartListImportEffect {
  readonly imported: {
    readonly classes: number;
    readonly entries: number;
  };
  readonly changed: {
    readonly classes: number;
    readonly entries: number;
  };
  readonly resultsRequiringRecalculation: number;
  readonly snapshotChanged: boolean;
}

export class StartListImportConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StartListImportConflictError";
  }
}

function sameInstant(left: Date | null, rightIso: string): boolean {
  return left !== null && left.getTime() === new Date(rightIso).getTime();
}

/**
 * Applies an already structurally validated StartList. The caller owns the
 * race UPDATE lock. Every referenced class and entry is locked and validated
 * before the first domain write.
 */
export async function applyStartListImport(
  tx: DbExecutor,
  raceId: string,
  parsed: StartListImport
): Promise<StartListImportEffect> {
  // Användartestet 2026-11-12: klassen matchas på IOF-id, annars på namn (klasser skapade för hand). Saknas en klass
  // avvisas listan med klassernas namn.
  const classIdByExternalId = await requireImportClasses(tx, raceId, parsed.classes);
  const classRows = await tx.select({
    id: schema.classes.id,
    startRule: schema.classes.startRule
  }).from(schema.classes).where(and(
    eq(schema.classes.raceId, raceId),
    inArray(schema.classes.id, [...new Set(classIdByExternalId.values())])
  )).orderBy(asc(schema.classes.id)).for("update");

  const classRowById = new Map(classRows.map((row) => [row.id, row]));
  const classByExternalId = new Map(parsed.classes.map((item) =>
    [item.classExternalId, classRowById.get(classIdByExternalId.get(item.classExternalId)!)] as const));
  if (new Set(classIdByExternalId.values()).size !== parsed.classes.length || [...classByExternalId.values()].some((row) => !row)) {
    throw new StartListImportConflictError("StartList refererar en okänd eller tvetydig klass");
  }

  const internalClassIds = classRows.map((row) => row.id);
  const entryRows = await tx.select({
    id: schema.entries.id,
    classId: schema.entries.classId,
    externalSource: schema.entries.externalSource,
    externalId: schema.entries.externalId,
    eventorPersonId: schema.entries.eventorPersonId,
    fixedStartTime: schema.entries.fixedStartTime,
    version: schema.entries.version
  }).from(schema.entries).where(and(
    eq(schema.entries.raceId, raceId),
    inArray(schema.entries.classId, internalClassIds)
  )).orderBy(asc(schema.entries.id)).for("update");

  const entryByExternalId = new Map<string, (typeof entryRows)[number]>();
  for (const entry of entryRows) {
    if (entry.externalSource !== "iof" || entry.externalId === null || entryByExternalId.has(entry.externalId)) {
      throw new StartListImportConflictError(
        "En refererad klass innehåller en entry utan entydig IOF-identitet"
      );
    }
    entryByExternalId.set(entry.externalId, entry);
  }

  const desiredStarts = new Map<string, string>();
  for (const listedClass of parsed.classes) {
    const raceClass = classByExternalId.get(listedClass.classExternalId);
    if (!raceClass) throw new StartListImportConflictError("StartList-klassen saknas i loppet");
    // Översynen 2026-11-02: en start utan EntryId matchas på Person.Id (anmälans Person.Id, eller id:t från anmälningsfilen
    // när den saknade EntryId). Matchningen måste vara entydig inom klassen.
    const importedClass = { ...listedClass, starts: listedClass.starts.map((start) => {
      if (start.entryExternalId || !start.personExternalId) return start;
      const matches = entryRows.filter((entry) => entry.classId === raceClass.id &&
        (entry.eventorPersonId === start.personExternalId || entry.externalId === start.personExternalId));
      if (matches.length !== 1 || !matches[0]!.externalId) {
        throw new StartListImportConflictError(`Person.Id ${start.personExternalId} matchar ${matches.length === 0 ? "ingen" : "flera"} anmälda i klassen`);
      }
      return { ...start, entryExternalId: matches[0]!.externalId };
    }) };
    const expectedEntries = entryRows.filter((entry) => entry.classId === raceClass.id);
    const importedIds = new Set(importedClass.starts.map((start) => start.entryExternalId));
    if (expectedEntries.length !== importedClass.starts.length ||
      expectedEntries.some((entry) => entry.externalId === null || !importedIds.has(entry.externalId))) {
      throw new StartListImportConflictError("StartList måste täcka varje entry i refererad klass exakt en gång");
    }
    for (const start of importedClass.starts) {
      const entry = entryByExternalId.get(start.entryExternalId);
      if (!entry || entry.classId !== raceClass.id) {
        throw new StartListImportConflictError("StartList-entryn saknas eller tillhör en annan klass");
      }
      if (desiredStarts.has(entry.id)) {
        throw new StartListImportConflictError("StartList-entryn förekommer mer än en gång");
      }
      desiredStarts.set(entry.id, start.startTime);
    }
  }

  const changedClasses = classRows.filter((row) => row.startRule !== "FIXED");
  const changedEntries = entryRows.filter((entry) => {
    const desired = desiredStarts.get(entry.id);
    return desired !== undefined && !sameInstant(entry.fixedStartTime, desired);
  });

  const changedEntryIds = changedEntries.map((entry) => entry.id);
  const entriesWithResults = changedEntryIds.length === 0 ? [] : await tx.selectDistinct({
    entryId: schema.resultRevisions.entryId
  }).from(schema.resultRevisions).where(inArray(schema.resultRevisions.entryId, changedEntryIds));

  // Importerade starttider ersätter klassernas lottning; efteranmälda placeras inte längre automatiskt.
  if (internalClassIds.length > 0) {
    await tx.update(schema.classes).set({ startDrawId: null }).where(and(
      inArray(schema.classes.id, internalClassIds), eq(schema.classes.raceId, raceId)));
  }
  for (const raceClass of changedClasses) {
    await tx.update(schema.classes).set({ startRule: "FIXED" }).where(and(
      eq(schema.classes.id, raceClass.id),
      eq(schema.classes.raceId, raceId)
    ));
  }
  for (const entry of changedEntries) {
    const desired = desiredStarts.get(entry.id);
    if (desired === undefined) throw new Error("Validerad starttid saknas");
    const [updated] = await tx.update(schema.entries).set({
      fixedStartTime: new Date(desired),
      version: entry.version + 1
    }).where(and(
      eq(schema.entries.id, entry.id),
      eq(schema.entries.raceId, raceId),
      eq(schema.entries.version, entry.version)
    )).returning({ id: schema.entries.id });
    if (!updated) throw new StartListImportConflictError("En entry ändrades samtidigt");
  }

  return {
    imported: {
      classes: parsed.classes.length,
      entries: parsed.classes.reduce((count, item) => count + item.starts.length, 0)
    },
    changed: { classes: changedClasses.length, entries: changedEntries.length },
    resultsRequiringRecalculation: entriesWithResults.length,
    snapshotChanged: changedClasses.length > 0 || changedEntries.length > 0
  };
}
