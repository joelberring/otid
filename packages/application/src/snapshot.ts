import { asc, eq, sql, and, inArray, isNotNull, isNull, or } from "drizzle-orm";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import type { RaceSnapshot } from "@o-tid/domain";
import { compareText } from "./serialization";
import { inUuids } from "./sql-ids";
import { loadTeamSprintRunners, teamSprintRunnerLayout } from "./team-sprint-readout";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbExecutor = Database | Transaction;

/**
 * Avläsningspaketets version (race.snapshot_version, ADR-0173 beslut 3). Höjs av den som ändrar paketets innehåll:
 * banor, klasser, deltagare, brickor, starttider och kontroller. Adminåtgärder kontrolleras inte mot versionen;
 * underlaget per löpare (ADR-0169) och revisionerna avgör. Ger den nya versionen.
 */
export async function bumpReadoutPackageVersion(tx: DbExecutor, raceId: string): Promise<number> {
  const [row] = await tx.update(schema.races).set({ snapshotVersion: sql`${schema.races.snapshotVersion} + 1` })
    .where(eq(schema.races.id, raceId)).returning({ snapshotVersion: schema.races.snapshotVersion });
  if (!row) throw new Error("Tävlingen saknas");
  return row.snapshotVersion;
}

export function sortRaceSnapshotForPackage(snapshot: RaceSnapshot) {
  return {
    race: snapshot.race,
    classes: [...snapshot.classes].sort((left, right) => compareText(left.id, right.id)),
    courses: [...snapshot.courses]
      .sort((left, right) => compareText(left.id, right.id))
      .map((course) => ({
        ...course,
        versions: [...course.versions]
          .sort((left, right) => left.version - right.version || compareText(left.id, right.id))
          .map(({ variants, ...version }) => ({
            ...version,
            controls: [...version.controls]
              .sort((left, right) => left.sequence - right.sequence || compareText(left.id, right.id)),
            // Gafflad banversion: varianterna i visningsordning. Saknas för banor utan varianter.
            ...(variants && variants.length > 0 ? {
              variants: [...variants]
                .sort((left, right) => left.sequence - right.sequence || compareText(left.id, right.id))
                .map((variant) => ({
                  ...variant,
                  controls: [...variant.controls]
                    .sort((left, right) => left.sequence - right.sequence || compareText(left.id, right.id))
                }))
            } : {})
          }))
      })),
    entries: [...snapshot.entries].sort((left, right) => compareText(left.id, right.id)),
    cardAssignments: [...snapshot.cardAssignments].sort((left, right) => compareText(left.id, right.id)),
    // Rättningar för hela tävlingen (PLAN.md steg 31); fältet saknas när det inte finns några.
    ...(snapshot.stationTimeAdjustments && snapshot.stationTimeAdjustments.length > 0 ? {
      stationTimeAdjustments: [...snapshot.stationTimeAdjustments].sort((left, right) => compareText(left.id, right.id))
    } : {}),
    ...(snapshot.controlsOutOfOrder && snapshot.controlsOutOfOrder.length > 0 ? {
      controlsOutOfOrder: [...snapshot.controlsOutOfOrder].sort((left, right) => compareText(left.id, right.id))
    } : {})
  };
}

/**
 * Steg 54 (ADR-0177): en avläsning behöver bara löparens (eller lagets) del av tävlingen, inte alla anmälda. Med `scope`
 * innehåller ögonblicksbilden alla klasser, banor och rättningar men bara deltagarna som har brickan (`cardNumber`, även
 * en inaktiv koppling) eller anges (`entryIds`), deras lagkamrater (stafett, teamsprint) och just de deltagarnas och
 * brickans kopplingar. Resultatmotorn ser då samma sak för löparen som i hela paketet: bedömningen läser bara brickans
 * ägare, dennes klass och bana, lagets sträckor och rättningarna. I en 25-mannastafett med 300 lag läses 25 deltagare i
 * stället för 7 500.
 */
export type RaceSnapshotScope = { readonly cardNumber?: string; readonly entryIds?: readonly string[] };

const snapshotEntryColumns = {
  id: schema.entries.id,
  raceId: schema.entries.raceId,
  classId: schema.entries.classId,
  givenName: schema.entries.givenName,
  familyName: schema.entries.familyName,
  organisationName: schema.entries.organisationName,
  fixedStartTime: schema.entries.fixedStartTime,
  courseVariantCode: schema.entries.courseVariantCode,
  teamId: schema.entries.teamId,
  relayLeg: schema.entries.relayLeg,
  externalId: schema.entries.externalId
};

/** Deltagarna i `scope` med lagkamrater (inte strukna), eller undefined för hela tävlingen. */
async function loadScopedEntries(db: DbExecutor, raceId: string, scope: RaceSnapshotScope | undefined) {
  if (!scope) return undefined;
  const seeds = new Set(scope.entryIds ?? []);
  if (scope.cardNumber !== undefined) {
    for (const row of await db.select({ entryId: schema.cardAssignments.entryId }).from(schema.cardAssignments)
      .where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.cardNumber, scope.cardNumber)))) seeds.add(row.entryId);
  }
  if (seeds.size === 0) return [];
  const ids = [...seeds];
  const team = db.select({ teamId: schema.entries.teamId }).from(schema.entries)
    .where(and(inUuids(schema.entries.id, ids), isNotNull(schema.entries.teamId)));
  return db.select(snapshotEntryColumns).from(schema.entries)
    .where(and(eq(schema.entries.raceId, raceId), isNull(schema.entries.struckAt),
      or(inUuids(schema.entries.id, ids), inArray(schema.entries.teamId, team))))
    .orderBy(asc(schema.entries.id));
}

export async function loadRaceSnapshot(db: DbExecutor, raceId: string, scope?: RaceSnapshotScope): Promise<RaceSnapshot> {
  const scopedEntries = await loadScopedEntries(db, raceId, scope);
  const scoped = scopedEntries?.map((row) => row.id);
  const [raceRow] = await db.select({
    id: schema.races.id,
    eventId: schema.races.eventId,
    name: schema.races.name,
    raceDate: schema.races.raceDate,
    snapshotVersion: schema.races.snapshotVersion,
    eventExists: schema.events.id
  }).from(schema.races)
    .leftJoin(schema.events, eq(schema.events.id, schema.races.eventId))
    .where(eq(schema.races.id, raceId));
  if (!raceRow) throw new Error("Loppet finns inte");
  if (!raceRow.eventExists) throw new Error("Evenemanget finns inte");

  // Uttryckliga kolumner: paketet behöver bara dessa (och en äldre databas under uppgradering saknar senare kolumner).
  const classRows = await db.select({ id: schema.classes.id, raceId: schema.classes.raceId, name: schema.classes.name,
    courseVersionId: schema.classes.courseVersionId, startRule: schema.classes.startRule,
    rogainingTimeLimitSeconds: schema.classes.rogainingTimeLimitSeconds,
    rogainingPenaltyPointsPerMinute: schema.classes.rogainingPenaltyPointsPerMinute, maxTimeMinutes: schema.classes.maxTimeMinutes,
    relayReadoutMode: schema.classes.relayReadoutMode,
    externalId: schema.classes.externalId }).from(schema.classes)
    .where(eq(schema.classes.raceId, raceId))
    .orderBy(asc(schema.classes.id));
  // Steg 47: stafettsträckor med egen bana; sträcklöparen bär banan i paketet.
  const legCourseRows = await db.select({ classId: schema.relayLegs.classId, leg: schema.relayLegs.leg,
    courseVersionId: schema.relayLegs.courseVersionId, fixedVariant: schema.relayLegs.courseVariantCode }).from(schema.relayLegs)
    .where(eq(schema.relayLegs.raceId, raceId));
  const referencedVersionIds = scope
    ? [...new Set([
        ...classRows.map((row) => row.courseVersionId),
        ...legCourseRows.flatMap((row) => row.courseVersionId ? [row.courseVersionId] : [])
      ])]
    : undefined;
  const courseRows = await db.select().from(schema.courses)
    .where(eq(schema.courses.raceId, raceId))
    .orderBy(asc(schema.courses.id));
  const versionRows = referencedVersionIds && referencedVersionIds.length === 0 ? [] : await db.select({
    id: schema.courseVersions.id,
    courseId: schema.courseVersions.courseId,
    version: schema.courseVersions.version,
    excludedVariants: schema.courseVersions.excludedVariants,
    createdAt: schema.courseVersions.createdAt
  }).from(schema.courseVersions)
    .innerJoin(schema.courses, eq(schema.courseVersions.courseId, schema.courses.id))
    .where(and(eq(schema.courses.raceId, raceId),
      ...(referencedVersionIds ? [inUuids(schema.courseVersions.id, referencedVersionIds)] : [])))
    .orderBy(
      asc(schema.courseVersions.courseId),
      asc(schema.courseVersions.version),
      asc(schema.courseVersions.id)
    );
  const versionIds = versionRows.map((row) => row.id);
  const courseControlRows = versionIds.length === 0 ? [] : await db.select({
    id: schema.courseControls.id,
    courseVersionId: schema.courseControls.courseVersionId,
    controlId: schema.courseControls.controlId,
    sequence: schema.courseControls.sequence,
    controlCode: schema.controls.code,
    points: schema.controls.points
  }).from(schema.courseControls)
    .innerJoin(schema.controls, eq(schema.courseControls.controlId, schema.controls.id))
    .where(inUuids(schema.courseControls.courseVersionId, versionIds))
    .orderBy(
      asc(schema.courseControls.courseVersionId),
      asc(schema.courseControls.sequence),
      asc(schema.courseControls.id)
    );
  const variantRows = versionIds.length === 0 ? [] : await db.select({
    id: schema.courseVariants.id,
    courseVersionId: schema.courseVariants.courseVersionId,
    code: schema.courseVariants.code,
    sequence: schema.courseVariants.sequence
  }).from(schema.courseVariants)
    .where(inUuids(schema.courseVariants.courseVersionId, versionIds))
    .orderBy(asc(schema.courseVariants.courseVersionId), asc(schema.courseVariants.sequence));
  const variantControlRows = variantRows.length === 0 ? [] : await db.select({
    id: schema.courseVariantControls.id,
    courseVariantId: schema.courseVariantControls.courseVariantId,
    controlId: schema.courseVariantControls.controlId,
    sequence: schema.courseVariantControls.sequence,
    controlCode: schema.controls.code
  }).from(schema.courseVariantControls)
    .innerJoin(schema.controls, eq(schema.courseVariantControls.controlId, schema.controls.id))
    .where(inUuids(schema.courseVariantControls.courseVariantId, variantRows.map((row) => row.id)))
    .orderBy(asc(schema.courseVariantControls.courseVariantId), asc(schema.courseVariantControls.sequence));
  // Strukna deltagare (PLAN.md steg 27) finns inte i paketet; deras bricka är släppt.
  const entryRows = scopedEntries ?? await db.select(snapshotEntryColumns).from(schema.entries)
    .where(and(eq(schema.entries.raceId, raceId), isNull(schema.entries.struckAt)))
    .orderBy(asc(schema.entries.id));
  const legCourse = new Map(legCourseRows.flatMap((row) => row.courseVersionId ? [[`${row.classId}:${row.leg}`, row.courseVersionId] as const] : []));
  // Sträckans fasta variant gäller en sträcklöpare som saknar egen (som Kartor till starten).
  const legFixedVariant = new Map(legCourseRows.flatMap((row) => row.fixedVariant ? [[`${row.classId}:${row.leg}`, row.fixedVariant] as const] : []));
  // Steg 48: teamsprint – varje sträcklöpares del av brickan (löparens sträckor i ordning, växlingskontrollen).
  const hasTeamSprint = classRows.some((row) => row.relayReadoutMode !== null);
  const teamSprint = legCourseRows.length === 0 || !hasTeamSprint
    ? new Map<string, NonNullable<RaceSnapshot["entries"][number]["teamSprint"]>>()
    : await loadTeamSprintParts(db, raceId, scoped);
  const assignmentRows = scoped !== undefined && scoped.length === 0 && scope?.cardNumber === undefined ? [] : await db.select().from(schema.cardAssignments)
    .where(and(eq(schema.cardAssignments.raceId, raceId), ...(scoped ? [
      scoped.length === 0
        ? eq(schema.cardAssignments.cardNumber, scope!.cardNumber!)
        : scope?.cardNumber !== undefined
          ? or(inUuids(schema.cardAssignments.entryId, scoped), eq(schema.cardAssignments.cardNumber, scope.cardNumber))!
          : inUuids(schema.cardAssignments.entryId, scoped)
    ] : [])))
    .orderBy(asc(schema.cardAssignments.id));
  const correctionRows = await db.select().from(schema.raceStationCorrections)
    .where(and(eq(schema.raceStationCorrections.raceId, raceId), isNull(schema.raceStationCorrections.removedAt)))
    .orderBy(asc(schema.raceStationCorrections.id));
  const stationTimeAdjustments = correctionRows.flatMap((row) => row.kind === "TIME_ADJUSTMENT" && row.offsetMs !== null
    ? [{ id: row.id, station: row.station, ...(row.controlCode !== null ? { controlCode: row.controlCode } : {}), offsetMs: row.offsetMs }]
    : []);
  const controlsOutOfOrder = correctionRows.flatMap((row) => row.kind === "CONTROL_OUT_OF_ORDER" && row.controlCode !== null
    ? [{ id: row.id, controlCode: row.controlCode }] : []);

  const versionsByCourse = new Map<string, typeof versionRows>();
  for (const version of versionRows) {
    let list = versionsByCourse.get(version.courseId);
    if (!list) { list = []; versionsByCourse.set(version.courseId, list); }
    list.push(version);
  }
  const controlsByVersion = new Map<string, typeof courseControlRows>();
  for (const control of courseControlRows) {
    let list = controlsByVersion.get(control.courseVersionId);
    if (!list) { list = []; controlsByVersion.set(control.courseVersionId, list); }
    list.push(control);
  }
  const variantsByVersion = new Map<string, typeof variantRows>();
  for (const variant of variantRows) {
    let list = variantsByVersion.get(variant.courseVersionId);
    if (!list) { list = []; variantsByVersion.set(variant.courseVersionId, list); }
    list.push(variant);
  }
  const controlsByVariant = new Map<string, typeof variantControlRows>();
  for (const control of variantControlRows) {
    let list = controlsByVariant.get(control.courseVariantId);
    if (!list) { list = []; controlsByVariant.set(control.courseVariantId, list); }
    list.push(control);
  }

  return sortRaceSnapshotForPackage({
    race: {
      id: raceRow.id,
      eventId: raceRow.eventId,
      name: raceRow.name,
      raceDate: raceRow.raceDate,
      snapshotVersion: raceRow.snapshotVersion
    },
    classes: classRows.map((row) => ({
      id: row.id,
      raceId: row.raceId,
      name: row.name,
      courseVersionId: row.courseVersionId,
      startRule: row.startRule,
      // Rogaining (ADR-0170 beslut 5): tidsgräns och straff följer med till avläsningens paket.
      ...(row.rogainingTimeLimitSeconds !== null && row.rogainingPenaltyPointsPerMinute !== null ? { rogaining: {
        timeLimitSeconds: row.rogainingTimeLimitSeconds, penaltyPointsPerMinute: row.rogainingPenaltyPointsPerMinute } } : {}),
      // Maxtid (PLAN.md steg 25) följer med till avläsningens paket och bedömningen.
      ...(row.maxTimeMinutes !== null && row.rogainingTimeLimitSeconds === null ? { maxTimeMinutes: row.maxTimeMinutes } : {}),
      ...(row.externalId ? { externalIdentity: { source: "iof" as const, externalId: row.externalId } } : {})
    })),
    courses: courseRows.map((course) => ({
      id: course.id,
      raceId: course.raceId,
      name: course.name,
      ...(course.externalId ? { externalIdentity: { source: "iof" as const, externalId: course.externalId } } : {}),
      versions: (versionsByCourse.get(course.id) ?? []).map((version) => {
        const variants = (variantsByVersion.get(version.id) ?? []).map((variant) => ({
          ...variant,
          controls: controlsByVariant.get(variant.id) ?? []
        }));
        return {
          id: version.id,
          courseId: version.courseId,
          version: version.version,
          createdAt: version.createdAt.toISOString(),
          // Ändrade rogainingpoäng följer med; NULL betyder förvalet.
          controls: (controlsByVersion.get(version.id) ?? [])
            .map(({ points, ...control }) => points === null ? control : { ...control, points }),
          ...(variants.length > 0 ? { variants } : {}),
          // ADR-0198: bortvalda varianter för avläsningens besked.
          ...(version.excludedVariants && version.excludedVariants.length > 0 ? { excludedVariants: version.excludedVariants } : {})
        };
      })
    })),
    entries: entryRows.map((row) => ({
      id: row.id,
      raceId: row.raceId,
      classId: row.classId,
      givenName: row.givenName,
      familyName: row.familyName,
      ...(row.organisationName ? { organisationName: row.organisationName } : {}),
      ...(row.fixedStartTime ? { fixedStartTime: row.fixedStartTime.toISOString() } : {}),
      ...(row.courseVariantCode ? { courseVariantCode: row.courseVariantCode }
        : row.relayLeg !== null && legFixedVariant.has(`${row.classId}:${row.relayLeg}`)
          ? { courseVariantCode: legFixedVariant.get(`${row.classId}:${row.relayLeg}`)! } : {}),
      ...(row.relayLeg !== null && legCourse.has(`${row.classId}:${row.relayLeg}`)
        ? { courseVersionId: legCourse.get(`${row.classId}:${row.relayLeg}`)! } : {}),
      ...(teamSprint.has(row.id) ? { teamSprint: teamSprint.get(row.id)! } : {}),
      ...(row.externalId ? { externalIdentity: { source: "iof" as const, externalId: row.externalId } } : {})
    })),
    cardAssignments: assignmentRows.map((row) => ({
      id: row.id,
      raceId: row.raceId,
      entryId: row.entryId,
      cardNumber: row.cardNumber,
      active: row.active,
      // Hyrbricka (PLAN.md steg 25): avläsningen ber funktionären samla in den.
      ...(row.isRental && !row.rentalReturned ? { rental: true } : {})
    })),
    stationTimeAdjustments,
    controlsOutOfOrder
  });
}

/**
 * Steg 48: teamsprint (ADR-0174 beslut 7). För klasser med växlingskontroll: varje sträcklöpare hör till brickans ägare
 * (`relay_card_entry_id`, annars sig själv); löparens sträckor i ordning ger delens nummer. Lagets sista sträcka slutar vid målet.
 */
export async function loadTeamSprintParts(db: DbExecutor, raceId: string, entryIds?: readonly string[]) {
  const only = entryIds === undefined ? undefined : new Set(entryIds);
  const rows = (await db.select({ id: schema.entries.id, teamId: schema.entries.teamId, leg: schema.entries.relayLeg,
    cardEntryId: schema.entries.relayCardEntryId, classId: schema.entries.classId, code: schema.classes.relayChangeoverCode })
    .from(schema.entries).innerJoin(schema.classes, eq(schema.classes.id, schema.entries.classId))
    .where(and(eq(schema.entries.raceId, raceId), isNotNull(schema.classes.relayChangeoverCode), isNotNull(schema.entries.teamId),
      eq(schema.classes.relayReadoutMode, "LAST_LEG"), isNull(schema.entries.struckAt))))
    // Steg 54: med en avgränsad ögonblicksbild bara de valda (hela lag, så delarna räknas som för hela tävlingen).
    .filter((row) => only === undefined || only.has(row.id));
  const result = new Map<string, NonNullable<RaceSnapshot["entries"][number]["teamSprint"]>>();
  // Steg 50: utläsning efter varje sträcka – delningen följer vilken utläsning varje sträckas resultat bygger på.
  for (const runner of await loadTeamSprintRunners(db, raceId, undefined, only)) {
    for (const [entryId, part] of teamSprintRunnerLayout(runner)) result.set(entryId, part);
  }
  if (rows.length === 0) return result;
  const legCounts = new Map((await db.select({ classId: schema.relayLegs.classId, leg: schema.relayLegs.leg }).from(schema.relayLegs)
    .where(eq(schema.relayLegs.raceId, raceId))).reduce((counts, row) => counts.set(row.classId, Math.max(counts.get(row.classId) ?? 0, row.leg)),
    new Map<string, number>()));
  const byRunner = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.cardEntryId ?? row.id;
    let list = byRunner.get(key);
    if (!list) { list = []; byRunner.set(key, list); }
    list.push(row);
  }
  for (const legs of byRunner.values()) {
    const sorted = [...legs].sort((left, right) => (left.leg ?? 0) - (right.leg ?? 0));
    sorted.forEach((row, index) => result.set(row.id, { part: index + 1, parts: sorted.length, changeoverCode: row.code!,
      endsAtFinish: row.leg === legCounts.get(row.classId) }));
  }
  return result;
}

/** Kontrollkoderna som är ur funktion i tävlingen just nu (PLAN.md steg 31), för sträcktidernas visning och export. */
export async function loadControlCodesOutOfOrder(db: DbExecutor, raceId: string): Promise<ReadonlySet<number>> {
  const rows = await db.select({ controlCode: schema.raceStationCorrections.controlCode }).from(schema.raceStationCorrections)
    .where(and(eq(schema.raceStationCorrections.raceId, raceId), eq(schema.raceStationCorrections.kind, "CONTROL_OUT_OF_ORDER"),
      isNull(schema.raceStationCorrections.removedAt)));
  return new Set(rows.flatMap((row) => row.controlCode === null ? [] : [row.controlCode]));
}
