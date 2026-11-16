import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import type { DeviceBatch } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { stationClock, cardTypeForNumber, type SimulatedCard } from "@o-tid/sportident";
import { zonedDate } from "@o-tid/domain";
import { copyRaceContent } from "./race-copy";
import { createManualClassAsAdmin } from "./manual-class";
import { registerEntryAsAdmin } from "./entry-registration";
import { DEMO_TIME_ZONE, demoReadoutEvent, ingestDemoReadouts, type DemoRaceAdmin, type DemoRaceResult } from "./demo-race";

/**
 * Demoläget med en mall (ägaren 2026-11-16: "Järflotta demotävling" bredvid demofilmerna). Gästens tävling är en kopia av
 * mallens innehåll (kontroller, banor, karta, banläggning; `copyRaceContent` utan personer) med dagens datum. Klasser,
 * påhittade löpare och resultat läggs sedan in som av en administratör, så att allt går genom samma regler som i en riktig
 * tävling. Tiderna räknas från nu, så att någon alltid är kvar i skogen. Allt är påhittat; mallen ändras aldrig.
 *
 * Löparna och klasserna följer `demo-startdata-jarflotta.json` i ägarens projekt. Klasserna kopplas till mallens banor på
 * banans namn; en klass vars bana saknas hoppas över med sina löpare.
 */
export const DEMO_TEMPLATE_CLASSES: readonly { className: string; courseName: string }[] = [
  { className: "H21", courseName: "Lång" }, { className: "D21", courseName: "Mellan" },
  { className: "H45", courseName: "Mellan" }, { className: "D45", courseName: "Kort" }
];

/** Godkänd, felstämplad (saknar en kontroll), bruten (avläst utan mål) eller ute (anmäld, inte avläst). */
export type DemoRunnerStatus = "OK" | "MP" | "DNF" | "OUT";

export interface DemoTemplateRunner {
  givenName: string; familyName: string; club: string; className: string;
  /** Sekunder per kilometer av banans längd. */
  pace: number;
  status: DemoRunnerStatus;
}

export const DEMO_TEMPLATE_RUNNERS: readonly DemoTemplateRunner[] = [
  { givenName: "Kalle", familyName: "Kompass", club: "OK Tallbacken", className: "H21", pace: 466, status: "OK" },
  { givenName: "Sten", familyName: "Brantlund", club: "OK Tallbacken", className: "H21", pace: 512, status: "OK" },
  { givenName: "Björn", familyName: "Granlid", club: "Skärgårdslöparna", className: "H21", pace: 0, status: "OUT" },
  { givenName: "Nils", familyName: "Gropström", club: "Skärgårdslöparna", className: "H21", pace: 0, status: "OUT" },
  { givenName: "Stina", familyName: "Stigfinnare", club: "OK Tallbacken", className: "D21", pace: 559, status: "OK" },
  { givenName: "Tuva", familyName: "Höjdkvist", club: "OK Tallbacken", className: "D21", pace: 641, status: "MP" },
  { givenName: "Saga", familyName: "Sankmark", club: "Skärgårdslöparna", className: "D21", pace: 0, status: "OUT" },
  { givenName: "Maja", familyName: "Sänka", club: "IF Gläntan", className: "D21", pace: 0, status: "OUT" },
  { givenName: "Olle", familyName: "Punkthöjd", club: "Skärgårdslöparna", className: "H45", pace: 574, status: "OK" },
  { givenName: "Åke", familyName: "Åsrygg", club: "IF Gläntan", className: "H45", pace: 0, status: "OUT" },
  { givenName: "Ture", familyName: "Stenmur", club: "IF Gläntan", className: "H45", pace: 0, status: "OUT" },
  { givenName: "Myra", familyName: "Mossberg", club: "OK Tallbacken", className: "D45", pace: 695, status: "OK" },
  { givenName: "Lo", familyName: "Kärrström", club: "OK Tallbacken", className: "D45", pace: 720, status: "OK" },
  { givenName: "Elsa", familyName: "Hällmark", club: "Skärgårdslöparna", className: "D45", pace: 760, status: "DNF" },
  { givenName: "Vera", familyName: "Udde", club: "Skärgårdslöparna", className: "D45", pace: 0, status: "OUT" },
  { givenName: "Ylva", familyName: "Bäckman", club: "IF Gläntan", className: "D45", pace: 0, status: "OUT" }
];

const FIRST_CARD = 8_101_001;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Samma tal varje gång för samma löpare och sträcka (0–1), så att demon ser likadan ut för alla. */
function wobble(runner: number, leg: number): number {
  const x = Math.sin(runner * 12.9898 + leg * 78.233) * 43_758.5453;
  return x - Math.floor(x);
}

/**
 * Stämplingarna för en löpare: banans tid (längd × tempo) fördelas på sträckorna med en jämn vikt plus lite slump, och var
 * sjunde sträcka ungefär kostar en bom. Felstämplad tappar en kontroll i mitten, bruten stannar efter halva banan.
 */
export function demoRun(input: { index: number; runner: DemoTemplateRunner; controlCodes: readonly number[]; lengthMeters: number;
  finishAt: Date }): { startAt: Date; punches: { code: number; at: Date }[]; finishAt?: Date } {
  const { index, runner, controlCodes } = input;
  const legs = controlCodes.length + 1;
  const weights = Array.from({ length: legs }, (_, leg) => 0.75 + 0.5 * wobble(index, leg) + (wobble(leg, index) > 0.86 ? 0.6 : 0));
  const total = Math.max(600, Math.round((Math.max(input.lengthMeters, 1000) / 1000) * runner.pace)) * 1000;
  const sum = weights.reduce((a, b) => a + b, 0);
  const startAt = new Date(input.finishAt.getTime() - total);
  let elapsed = 0;
  const punches = controlCodes.map((code, leg) => {
    elapsed += (weights[leg]! / sum) * total;
    return { code, at: new Date(startAt.getTime() + Math.round(elapsed / 1000) * 1000) };
  });
  if (runner.status === "MP" && punches.length > 2) punches.splice(Math.floor(punches.length / 2), 1);
  if (runner.status === "DNF") return { startAt, punches: punches.slice(0, Math.max(1, Math.floor(punches.length / 2))) };
  return { startAt, punches, finishAt: input.finishAt };
}

export type DemoTemplateResult = DemoRaceResult | { status: "no-template" };

/**
 * Gästens tävling ur mallen. Gästkontot finns redan och `admin` är dess session; tävlingen skapas med gästen som ägare.
 */
export async function seedTemplateDemoRace(db: Database, input: { accountId: string; templateRaceId: string; owner: Omit<DemoRaceAdmin, "raceId">;
  now?: Date }): Promise<DemoTemplateResult> {
  const now = input.now ?? new Date();
  const today = zonedDate(now, DEMO_TIME_ZONE);
  const created = await db.transaction(async tx => {
    const [template] = await tx.select({ id: schema.races.id, name: schema.races.name, raceDate: schema.races.raceDate,
      raceType: schema.races.raceType, courseMapScale: schema.races.courseMapScale, eventName: schema.events.name,
      timeZone: schema.events.timeZone })
      .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(eq(schema.races.id, input.templateRaceId));
    if (!template) return undefined;
    const [event] = await tx.insert(schema.events).values({ name: template.eventName, startsOn: today, timeZone: template.timeZone,
      createdAt: now }).returning({ id: schema.events.id });
    if (!event) throw new Error("Eventet kunde inte skapas");
    const [race] = await tx.insert(schema.races).values({ eventId: event.id, name: template.name, raceDate: today,
      raceType: template.raceType, courseMapScale: template.courseMapScale, snapshotVersion: 1, createdAt: now })
      .returning({ id: schema.races.id });
    if (!race) throw new Error("Loppet kunde inte skapas");
    await tx.insert(schema.eventAdministrationGrants).values({ eventId: event.id, accountId: input.accountId, role: "OWNER", grantedAt: now });
    await copyRaceContent(tx, { sourceRaceId: template.id, raceId: race.id, timeZone: template.timeZone,
      dayShift: Math.round((Date.parse(today) - Date.parse(template.raceDate)) / DAY_MS), now, accountId: input.accountId,
      includePeople: false });
    return { raceId: race.id, timeZone: template.timeZone };
  });
  if (!created) return { status: "no-template" };
  const admin: DemoRaceAdmin = { ...input.owner, raceId: created.raceId };

  // Banorna i kopian: senaste versionen per namn, med kontrollföljden.
  const courses = await db.select({ id: schema.courses.id, name: schema.courses.name, lengthMeters: schema.courses.lengthMeters })
    .from(schema.courses).where(eq(schema.courses.raceId, created.raceId));
  const existing = await db.select({ id: schema.classes.id, name: schema.classes.name, courseVersionId: schema.classes.courseVersionId,
    startRule: schema.classes.startRule }).from(schema.classes).where(eq(schema.classes.raceId, created.raceId));
  const classes = new Map<string, { classId: string; courseVersionId: string; startRule: "FIXED" | "PUNCH"; controls: number[];
    lengthMeters: number }>();
  for (const wanted of DEMO_TEMPLATE_CLASSES) {
    const course = courses.find(row => row.name.trim().toLowerCase() === wanted.courseName.toLowerCase());
    if (!course) continue;
    const [version] = await db.select({ id: schema.courseVersions.id }).from(schema.courseVersions)
      .where(eq(schema.courseVersions.courseId, course.id)).orderBy(desc(schema.courseVersions.version)).limit(1);
    if (!version) continue;
    const controls = (await db.select({ code: schema.controls.code }).from(schema.courseControls)
      .innerJoin(schema.controls, eq(schema.controls.id, schema.courseControls.controlId))
      .where(and(eq(schema.courseControls.courseVersionId, version.id), eq(schema.controls.raceId, created.raceId)))
      .orderBy(asc(schema.courseControls.sequence))).map(row => row.code);
    if (controls.length === 0) continue;
    const prior = existing.find(row => row.name === wanted.className);
    if (prior) {
      classes.set(wanted.className, { classId: prior.id, courseVersionId: prior.courseVersionId, startRule: prior.startRule,
        controls, lengthMeters: course.lengthMeters ?? 0 });
      continue;
    }
    const requestId = randomUUID();
    const result = await createManualClassAsAdmin(db, { ...admin, idempotencyKey: `manual-class-create:${requestId}`,
      request: { formatVersion: 1, requestId, courseVersionId: version.id, className: wanted.className, startRule: "PUNCH" } }, now);
    if (result.status !== "created") return { status: "failed", step: `klassen ${wanted.className} (${result.status})` };
    classes.set(wanted.className, { classId: result.response.classId, courseVersionId: version.id, startRule: "PUNCH", controls,
      lengthMeters: course.lengthMeters ?? 0 });
  }

  const events: DeviceBatch["events"] = [];
  for (const [index, runner] of DEMO_TEMPLATE_RUNNERS.entries()) {
    const raceClass = classes.get(runner.className);
    if (!raceClass) continue;
    const cardNumber = FIRST_CARD + index;
    if (!cardTypeForNumber(cardNumber)) continue;
    const result = await registerEntryAsAdmin(db, { ...admin, idempotencyKey: `entry-registration:${randomUUID()}`,
      request: { formatVersion: 1, classId: raceClass.classId, expectedCourseVersionId: raceClass.courseVersionId,
        expectedStartRule: raceClass.startRule, givenName: runner.givenName, familyName: runner.familyName,
        organisationName: runner.club, cardNumber: String(cardNumber), fixedStartTime: null } }, now);
    if (result.status !== "registered") return { status: "failed", step: `${runner.givenName} ${runner.familyName} (${result.status})` };
    if (runner.status === "OUT") continue;
    // De som gått i mål kom in under den senaste timmen, med några minuters mellanrum.
    const finishAt = new Date(now.getTime() - (8 + (index % 7) * 6) * 60_000);
    const run = demoRun({ index, runner, controlCodes: raceClass.controls, lengthMeters: raceClass.lengthMeters, finishAt });
    const simulated: SimulatedCard = { cardType: cardTypeForNumber(cardNumber)!, cardNumber,
      start: stationClock(run.startAt, created.timeZone),
      ...(run.finishAt ? { finish: stationClock(run.finishAt, created.timeZone) } : {}),
      punches: run.punches.map(punch => ({ code: punch.code, time: stationClock(punch.at, created.timeZone) })) };
    events.push(demoReadoutEvent(simulated, new Date(finishAt.getTime() + 60_000), events.length + 1));
  }
  return ingestDemoReadouts(db, admin, events, now);
}
