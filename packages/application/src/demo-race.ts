import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DeviceBatch, SportidentReadoutPayload } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { normalizeCard, readSimulatedCard, simulatedRun } from "@o-tid/sportident";
import { createManualCourseClassAsAdmin } from "./manual-course-class";
import { createOrganizerEvent } from "./organizer-events";
import { registerEntryAsAdmin } from "./entry-registration";
import { ingestReadoutsAsAdmin } from "./readout-station";

/**
 * Övningstävlingen med påhittade löpare (ADR-0168 steg 5, demoläget del 2): två banor, tio anmälda och sju avläsningar. Tre
 * löpare är kvar i skogen och en är felstämplad, så att allt i arbetsytan går att prova. Används av `pnpm demo` och av
 * gästkontot på startsidan. Endast syntetiska namn.
 */
export const DEMO_TIME_ZONE = "Europe/Stockholm";
const COURSES = [
  { name: "Lång", className: "Lång", controls: [31, 32, 33, 34, 35, 36, 37, 38] },
  { name: "Kort", className: "Kort", controls: [31, 33, 35, 37] }
] as const;
const RUNNERS = [
  ["Anna", "Ek"], ["Bo", "Lind"], ["Cecilia", "Holm"], ["David", "Berg"], ["Elsa", "Sjö"],
  ["Filip", "Strand"], ["Greta", "Ås"], ["Hugo", "Mo"], ["Ida", "Dal"], ["Jonas", "Hed"]
] as const;

export interface DemoRaceOwner {
  readonly sessionToken: string;
  readonly csrfToken: string;
  /** Gästkontot (demoläget del 2) skapar sin övningstävling själv; annars vägras gäster på kontots sidor. */
  readonly guest?: boolean;
}

export interface DemoRaceTexts { readonly eventName: string; readonly raceName: string; readonly organisation: string }

export const DEMO_RACE_SV: DemoRaceTexts = { eventName: "Demoträning", raceName: "Kvällsträning", organisation: "Demo OK" };

export type DemoRaceResult = { status: "created"; raceId: string; eventId: string } | { status: "failed"; step: string };

export async function seedDemoRace(db: Database, owner: DemoRaceOwner, options: { now?: Date; texts?: DemoRaceTexts } = {})
  : Promise<DemoRaceResult> {
  const now = options.now ?? new Date();
  const texts = options.texts ?? DEMO_RACE_SV;
  const proof = { sessionToken: owner.sessionToken, csrfCookie: owner.csrfToken, csrfHeader: owner.csrfToken };
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: DEMO_TIME_ZONE }).format(now);
  const created = await createOrganizerEvent(db, { ...proof, ...(owner.guest ? { allowGuest: true } : {}),
    idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: `${texts.eventName} ${today}`, raceName: texts.raceName, raceDate: today,
      timeZone: DEMO_TIME_ZONE }) }, now);
  if (created.status !== "created") return { status: "failed", step: `tävlingen (${created.status})` };
  const raceId = created.response.raceId;
  const admin = { ...proof, raceId };

  const classes = [];
  for (const course of COURSES) {
    const requestId = randomUUID();
    const result = await createManualCourseClassAsAdmin(db, { ...admin, idempotencyKey: `manual-course-class-create:${requestId}`,
      request: { formatVersion: 1, requestId, courseName: course.name, className: course.className, startRule: "PUNCH",
        controlCodes: [...course.controls] } }, now);
    if (result.status !== "created") return { status: "failed", step: `banan ${course.name} (${result.status})` };
    classes.push({ ...course, classId: result.response.classId, courseVersionId: result.response.courseVersionId });
  }

  const runners = [];
  for (const [index, [givenName, familyName]] of RUNNERS.entries()) {
    const raceClass = classes[index % classes.length]!;
    const cardNumber = 8_100_001 + index;
    const result = await registerEntryAsAdmin(db, { ...admin, idempotencyKey: `entry-registration:${randomUUID()}`,
      request: { formatVersion: 1, classId: raceClass.classId, expectedCourseVersionId: raceClass.courseVersionId,
        expectedStartRule: "PUNCH", givenName, familyName, organisationName: texts.organisation, cardNumber: String(cardNumber),
        fixedStartTime: null } }, now);
    if (result.status !== "registered") return { status: "failed", step: `${givenName} ${familyName} (${result.status})` };
    runners.push({ cardNumber, controls: raceClass.controls });
  }

  // Sju har gått i mål; löpare 4 missade en kontroll. Löpare 8–10 är kvar i skogen.
  const events: DeviceBatch["events"] = runners.slice(0, 7).map((runner, index) => {
    const startAt = new Date(now.getTime() - (75 - index * 3) * 60_000);
    const finishAt = new Date(now.getTime() - (35 - index * 4) * 60_000);
    const controls = index === 3 ? runner.controls.filter((code) => code !== 33) : runner.controls;
    const read = readSimulatedCard(simulatedRun(runner.cardNumber, { startAt, finishAt, controlCodes: controls, timeZone: DEMO_TIME_ZONE }));
    const readAt = new Date(finishAt.getTime() + 60_000);
    const card = normalizeCard(read.card, { reference: readAt, timeZone: DEMO_TIME_ZONE });
    const payload: SportidentReadoutPayload = {
      cardNumber: card.cardNumber, cardType: card.cardType,
      ...(card.startPunchedAt ? { startPunchedAt: card.startPunchedAt } : {}),
      ...(card.finishPunchedAt ? { finishPunchedAt: card.finishPunchedAt } : {}),
      punches: card.punches.map((punch) => ({ code: punch.code, punchedAt: punch.punchedAt })),
      untimedPunchCodes: [...card.untimedPunchCodes],
      frames: read.frames.map((frame) => Buffer.from(frame).toString("hex")),
      stationSerial: 999_001, simulated: true
    };
    return { localSequence: index + 1, stationReceivedAt: readAt.toISOString(), transport: "sportident",
      payload, contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
  });
  const [race] = await db.select({ snapshotVersion: schema.races.snapshotVersion, eventId: schema.races.eventId })
    .from(schema.races).where(eq(schema.races.id, raceId));
  if (!race) return { status: "failed", step: "tävlingen (saknas)" };
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: race.snapshotVersion,
    firstSequence: 1, lastSequence: events.length, events };
  const ingested = await ingestReadoutsAsAdmin(db, { ...admin, batch }, now);
  if (ingested.status !== "ok") return { status: "failed", step: `avläsningarna (${ingested.status})` };
  return { status: "created", raceId, eventId: race.eventId };
}
