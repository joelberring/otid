import { asc, eq, sql, and, isNull } from "drizzle-orm";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import type { RaceSnapshot } from "@o-tid/domain";
import { compareText } from "./serialization";

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

export async function loadRaceSnapshot(db: DbExecutor, raceId: string): Promise<RaceSnapshot> {
  const [raceRow] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
  if (!raceRow) throw new Error("Loppet finns inte");
  const [eventRow] = await db.select().from(schema.events).where(eq(schema.events.id, raceRow.eventId));
  if (!eventRow) throw new Error("Evenemanget finns inte");

  const classRows = await db.select().from(schema.classes)
    .where(eq(schema.classes.raceId, raceId))
    .orderBy(asc(schema.classes.id));
  const courseRows = await db.select().from(schema.courses)
    .where(eq(schema.courses.raceId, raceId))
    .orderBy(asc(schema.courses.id));
  const versionRows = await db.select({
    id: schema.courseVersions.id,
    courseId: schema.courseVersions.courseId,
    version: schema.courseVersions.version,
    createdAt: schema.courseVersions.createdAt
  }).from(schema.courseVersions)
    .innerJoin(schema.courses, eq(schema.courseVersions.courseId, schema.courses.id))
    .where(eq(schema.courses.raceId, raceId))
    .orderBy(
      asc(schema.courseVersions.courseId),
      asc(schema.courseVersions.version),
      asc(schema.courseVersions.id)
    );
  const courseControlRows = await db.select({
    id: schema.courseControls.id,
    courseVersionId: schema.courseControls.courseVersionId,
    controlId: schema.courseControls.controlId,
    sequence: schema.courseControls.sequence,
    controlCode: schema.controls.code,
    points: schema.controls.points
  }).from(schema.courseControls)
    .innerJoin(schema.controls, eq(schema.courseControls.controlId, schema.controls.id))
    .innerJoin(schema.courseVersions, eq(schema.courseControls.courseVersionId, schema.courseVersions.id))
    .innerJoin(schema.courses, eq(schema.courseVersions.courseId, schema.courses.id))
    .where(eq(schema.courses.raceId, raceId))
    .orderBy(
      asc(schema.courseControls.courseVersionId),
      asc(schema.courseControls.sequence),
      asc(schema.courseControls.id)
    );
  const variantRows = await db.select({
    id: schema.courseVariants.id,
    courseVersionId: schema.courseVariants.courseVersionId,
    code: schema.courseVariants.code,
    sequence: schema.courseVariants.sequence
  }).from(schema.courseVariants)
    .innerJoin(schema.courseVersions, eq(schema.courseVariants.courseVersionId, schema.courseVersions.id))
    .innerJoin(schema.courses, eq(schema.courseVersions.courseId, schema.courses.id))
    .where(eq(schema.courses.raceId, raceId))
    .orderBy(asc(schema.courseVariants.courseVersionId), asc(schema.courseVariants.sequence));
  const variantControlRows = variantRows.length === 0 ? [] : await db.select({
    id: schema.courseVariantControls.id,
    courseVariantId: schema.courseVariantControls.courseVariantId,
    controlId: schema.courseVariantControls.controlId,
    sequence: schema.courseVariantControls.sequence,
    controlCode: schema.controls.code
  }).from(schema.courseVariantControls)
    .innerJoin(schema.controls, eq(schema.courseVariantControls.controlId, schema.controls.id))
    .innerJoin(schema.courseVariants, eq(schema.courseVariantControls.courseVariantId, schema.courseVariants.id))
    .innerJoin(schema.courseVersions, eq(schema.courseVariants.courseVersionId, schema.courseVersions.id))
    .innerJoin(schema.courses, eq(schema.courseVersions.courseId, schema.courses.id))
    .where(eq(schema.courses.raceId, raceId))
    .orderBy(asc(schema.courseVariantControls.courseVariantId), asc(schema.courseVariantControls.sequence));
  // Strukna deltagare (PLAN.md steg 27) finns inte i paketet; deras bricka är släppt.
  const entryRows = await db.select().from(schema.entries)
    .where(and(eq(schema.entries.raceId, raceId), isNull(schema.entries.struckAt)))
    .orderBy(asc(schema.entries.id));
  const assignmentRows = await db.select().from(schema.cardAssignments)
    .where(eq(schema.cardAssignments.raceId, raceId))
    .orderBy(asc(schema.cardAssignments.id));
  const correctionRows = await db.select().from(schema.raceStationCorrections)
    .where(and(eq(schema.raceStationCorrections.raceId, raceId), isNull(schema.raceStationCorrections.removedAt)))
    .orderBy(asc(schema.raceStationCorrections.id));
  const stationTimeAdjustments = correctionRows.flatMap((row) => row.kind === "TIME_ADJUSTMENT" && row.offsetMs !== null
    ? [{ id: row.id, station: row.station, ...(row.controlCode !== null ? { controlCode: row.controlCode } : {}), offsetMs: row.offsetMs }]
    : []);
  const controlsOutOfOrder = correctionRows.flatMap((row) => row.kind === "CONTROL_OUT_OF_ORDER" && row.controlCode !== null
    ? [{ id: row.id, controlCode: row.controlCode }] : []);

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
      versions: versionRows.filter((version) => version.courseId === course.id).map((version) => {
        const variants = variantRows.filter((variant) => variant.courseVersionId === version.id).map((variant) => ({
          ...variant,
          controls: variantControlRows.filter((control) => control.courseVariantId === variant.id)
        }));
        return {
          id: version.id,
          courseId: version.courseId,
          version: version.version,
          createdAt: version.createdAt.toISOString(),
          // Ändrade rogainingpoäng följer med; NULL betyder förvalet.
          controls: courseControlRows.filter((control) => control.courseVersionId === version.id)
            .map(({ points, ...control }) => points === null ? control : { ...control, points }),
          ...(variants.length > 0 ? { variants } : {})
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
      ...(row.courseVariantCode ? { courseVariantCode: row.courseVariantCode } : {}),
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

/** Kontrollkoderna som är ur funktion i tävlingen just nu (PLAN.md steg 31), för sträcktidernas visning och export. */
export async function loadControlCodesOutOfOrder(db: DbExecutor, raceId: string): Promise<ReadonlySet<number>> {
  const rows = await db.select({ controlCode: schema.raceStationCorrections.controlCode }).from(schema.raceStationCorrections)
    .where(and(eq(schema.raceStationCorrections.raceId, raceId), eq(schema.raceStationCorrections.kind, "CONTROL_OUT_OF_ORDER"),
      isNull(schema.raceStationCorrections.removedAt)));
  return new Set(rows.flatMap((row) => row.controlCode === null ? [] : [row.controlCode]));
}
