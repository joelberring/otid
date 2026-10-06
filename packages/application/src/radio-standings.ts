import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { publicRadioResponseSchema, type PublicRadioPassage, type PublicRadioResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { radioClassStandings, type RadioPassage, type RadioRunner } from "@o-tid/domain";
import { publicResultTimings } from "./results";

/**
 * Mellantider vid radiokontrollerna (ADR-0172 beslut 5), publikt och för speakern. Stämplingarna matchas mot
 * löparna här, vid läsning, med brickan som löparen har nu (brickan kan ändras efter stämplingen). Avlästa löpare
 * tas från samma publicerade resultat som resultatlistan; resultatlogiken (tid och placering vid kontrollen) finns
 * i domänen. Stafettens sträcklöpare får inga mellantider än. Bricknummer lämnar aldrig servern här.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const LATEST = 30;

type Entry = { id: string; publicResultId: string; classId: string; givenName: string; familyName: string;
  organisationName: string | null; fixedStartTime: Date | null };

/** Radiokontrollernas koder per klass, i banans ordning (även gafflade varianter). */
async function classControlOrder(tx: Transaction, raceId: string, codes: readonly number[]): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  if (codes.length === 0) return result;
  const rows = await tx.execute<{ class_id: string; code: number; position: number }>(sql`
    select cl.id as class_id, ctl.code as code, min(used.sequence) as position
    from ${schema.classes} cl
    join (
      select cc.course_version_id, cc.control_id, cc.sequence from ${schema.courseControls} cc
      union all
      select v.course_version_id, vc.control_id, vc.sequence from ${schema.courseVariantControls} vc
        join ${schema.courseVariants} v on v.id = vc.course_variant_id
    ) used on used.course_version_id = cl.course_version_id
    join ${schema.controls} ctl on ctl.id = used.control_id
    where cl.race_id = ${raceId} and ctl.code in (${sql.join(codes.map(code => sql`${code}`), sql`, `)})
    group by cl.id, ctl.code
    order by cl.id, min(used.sequence), ctl.code`);
  for (const row of rows.rows) result.set(row.class_id, [...(result.get(row.class_id) ?? []), Number(row.code)]);
  return result;
}

async function read(tx: Transaction, raceId: string): Promise<PublicRadioResponse> {
  const [race] = await tx.select({ timeZone: schema.events.timeZone }).from(schema.races)
    .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(eq(schema.races.id, raceId));
  if (!race) throw new Error("Loppet finns inte");
  const empty = (enabled: boolean): PublicRadioResponse => ({ formatVersion: 1, raceId, enabled, timeZone: race.timeZone, classes: [], latest: [] });
  const [link] = await tx.select({ enabled: schema.raceRadioLinks.enabled }).from(schema.raceRadioLinks)
    .where(eq(schema.raceRadioLinks.raceId, raceId));
  if (!link?.enabled) return empty(false);
  const controls = await tx.select({ code: schema.raceRadioControls.controlCode, label: schema.raceRadioControls.label })
    .from(schema.raceRadioControls).where(eq(schema.raceRadioControls.raceId, raceId)).orderBy(asc(schema.raceRadioControls.controlCode));
  if (controls.length === 0) return empty(true);
  const codes = controls.map(control => control.code);
  const labels = new Map(controls.map(control => [control.code, control.label]));

  const [entries, cards, punches, classes, order, finished] = await Promise.all([
    tx.select({ id: schema.entries.id, publicResultId: schema.entries.publicResultId, classId: schema.entries.classId,
      givenName: schema.entries.givenName, familyName: schema.entries.familyName, organisationName: schema.entries.organisationName,
      fixedStartTime: schema.entries.fixedStartTime }).from(schema.entries)
      .where(and(eq(schema.entries.raceId, raceId), isNull(schema.entries.teamId))) as Promise<Entry[]>,
    tx.select({ entryId: schema.cardAssignments.entryId, cardNumber: schema.cardAssignments.cardNumber }).from(schema.cardAssignments)
      .where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.active, true))),
    tx.select({ cardNumber: schema.radioPunches.cardNumber, controlCode: schema.radioPunches.controlCode, punchedAt: schema.radioPunches.punchedAt })
      .from(schema.radioPunches).where(and(eq(schema.radioPunches.raceId, raceId), inArray(schema.radioPunches.controlCode, codes)))
      .orderBy(asc(schema.radioPunches.punchedAt)).limit(200_000),
    tx.select({ id: schema.classes.id, name: schema.classes.name }).from(schema.classes).where(eq(schema.classes.raceId, raceId)),
    classControlOrder(tx, raceId, codes),
    publicResultTimings(tx, raceId)
  ]);

  // Brickan som löparen har nu. En bricka är aktiv hos högst en löpare i loppet.
  const entryByCard = new Map(cards.map(card => [card.cardNumber.replace(/^0+/, ""), card.entryId]));
  const punchesByEntry = new Map<string, { controlCode: number; punchedAtMs: number }[]>();
  for (const punch of punches) {
    const entryId = entryByCard.get(punch.cardNumber);
    if (!entryId) continue;
    punchesByEntry.set(entryId, [...(punchesByEntry.get(entryId) ?? []), { controlCode: punch.controlCode, punchedAtMs: punch.punchedAt.getTime() }]);
  }
  const finishedByEntry = new Map(finished.map(row => [row.entryId, row]));
  const entryById = new Map(entries.map(entry => [entry.id, entry]));
  const className = new Map(classes.map(row => [row.id, row.name]));

  // Löpare per klass: avlästa i resultatets klass, övriga i sin anmälda klass.
  const runnersByClass = new Map<string, RadioRunner[]>();
  for (const entry of entries) {
    const result = finishedByEntry.get(entry.id);
    const ownPunches = punchesByEntry.get(entry.id) ?? [];
    if (!result && ownPunches.length === 0) continue;
    const classId = result?.classId ?? entry.classId;
    const runner: RadioRunner = { key: entry.id, punches: ownPunches,
      startMs: result?.startMs ?? entry.fixedStartTime?.getTime() ?? null,
      ...(result ? { finished: { status: result.status, splits: result.splits } } : {}) };
    runnersByClass.set(classId, [...(runnersByClass.get(classId) ?? []), runner]);
  }

  const passage = (row: RadioPassage, classId: string): PublicRadioPassage => {
    const entry = entryById.get(row.key)!;
    return { publicResultId: entry.publicResultId, givenName: entry.givenName, familyName: entry.familyName,
      organisationName: entry.organisationName, className: className.get(classId) ?? "", controlCode: row.controlCode,
      label: labels.get(row.controlCode) ?? null, passedAt: row.passedAtMs === null ? null : new Date(row.passedAtMs).toISOString(),
      elapsedMs: row.elapsedMs === null ? null : Math.max(0, Math.round(row.elapsedMs)), place: row.place, finished: row.finished };
  };

  const resultClasses: PublicRadioResponse["classes"] = [];
  const feed: { passage: PublicRadioPassage; at: number }[] = [];
  for (const [classId, runners] of runnersByClass) {
    const classCodes = order.get(classId) ?? [];
    if (classCodes.length === 0) continue;
    const standings = radioClassStandings(runners, classCodes);
    const withRadio = new Set(runners.filter(runner => runner.punches.length > 0).map(runner => runner.key));
    const shown = standings.controls.map(control => ({ controlCode: control.controlCode, label: labels.get(control.controlCode) ?? null,
      passages: control.passages.map(row => passage(row, classId)) }));
    // Klassen visas när någon har passerat en radiokontroll (avlästa löpares tider ensamma är inte "live").
    if (!standings.controls.some(control => control.passages.some(row => withRadio.has(row.key)))) continue;
    resultClasses.push({ className: className.get(classId) ?? "", controls: shown,
      onTheWay: standings.onTheWay.map(row => passage(row, classId)) });
    for (const control of standings.controls) {
      for (const row of control.passages) {
        const radio = punchesByEntry.get(row.key)?.filter(punch => punch.controlCode === row.controlCode) ?? [];
        if (radio.length === 0) continue;
        feed.push({ passage: passage(row, classId), at: row.source === "RADIO" && row.passedAtMs !== null ? row.passedAtMs
          : Math.min(...radio.map(punch => punch.punchedAtMs)) });
      }
    }
  }
  resultClasses.sort((a, b) => a.className.localeCompare(b.className, "sv"));
  const latest = feed.sort((a, b) => b.at - a.at).slice(0, LATEST).map(row => ({ ...row.passage, passedAt: new Date(row.at).toISOString() }));
  return { formatVersion: 1, raceId, enabled: true, timeZone: race.timeZone, classes: resultClasses, latest };
}

/** Publika mellantider. Anroparen har redan kontrollerat att tävlingen får visas (`publicRaceAccess`). */
export async function readPublicRadio(db: Database, raceId: string): Promise<PublicRadioResponse> {
  const response = await db.transaction(tx => read(tx, raceId), { isolationLevel: "repeatable read" });
  return publicRadioResponseSchema.parse(response);
}

/** Om radion är påslagen för tävlingen (tävlingssidan visar "Radiokontroller live"). */
export async function isRadioLive(db: Database, raceId: string): Promise<boolean> {
  const [row] = await db.select({ enabled: schema.raceRadioLinks.enabled }).from(schema.raceRadioLinks)
    .innerJoin(schema.raceRadioControls, eq(schema.raceRadioControls.raceId, schema.raceRadioLinks.raceId))
    .where(and(eq(schema.raceRadioLinks.raceId, raceId), eq(schema.raceRadioLinks.enabled, true))).limit(1);
  return row !== undefined;
}
