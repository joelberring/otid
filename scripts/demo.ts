/**
 * `pnpm demo` – skapar en färdig träningstävling i den lokala databasen
 * (ADR-0168, steg 5). Kör migreringar, skapar kontot `demo@o-tid.local`, en tävling med
 * två banor, tio anmälda löpare och sju avläsningar. Tre löpare är kvar i
 * skogen och en är felstämplad, så att allt i arbetsytan går att prova.
 *
 * Endast syntetiska namn. Körs inte mot en produktionsmiljö.
 */
import { createHash, randomUUID } from "node:crypto";
import type { DeviceBatch, SportidentReadoutPayload } from "../packages/contracts/src/index.ts";
import { createDatabase, migrate } from "../packages/database/src/index.ts";
import {
  createEventAsUserAccount,
  createManualCourseClassAsAdministrator,
  enterRaceAsUserAccount,
  ingestReadoutsAsAdministrator,
  loginUserAccount,
  registerEntryAsAdmin,
  registerUserAccount
} from "../packages/application/src/index.ts";
import { normalizeCard, readSimulatedCard, simulatedRun } from "../packages/sportident/src/index.ts";

const EMAIL = "demo@o-tid.local";
const PASSWORD = "demo-traning-1";
const TIME_ZONE = "Europe/Stockholm";
const COURSES = [
  { name: "Lång", className: "Lång", controls: [31, 32, 33, 34, 35, 36, 37, 38] },
  { name: "Kort", className: "Kort", controls: [31, 33, 35, 37] }
] as const;
const RUNNERS = [
  ["Anna", "Ek"], ["Bo", "Lind"], ["Cecilia", "Holm"], ["David", "Berg"], ["Elsa", "Sjö"],
  ["Filip", "Strand"], ["Greta", "Ås"], ["Hugo", "Mo"], ["Ida", "Dal"], ["Jonas", "Hed"]
] as const;

function fail(message: string): never {
  throw new Error(message);
}

/** Databasen i Docker kan behöva en stund vid första starten (särskilt emulerad på Mac). */
async function waitForDatabase(pool: { query(text: string): Promise<unknown> }): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await pool.query("select 1");
      return;
    } catch (error) {
      if (Date.now() > deadline) throw new Error(`Databasen svarar inte: ${describe(error)}. Kör "docker compose ps" och kontrollera att postgres är igång.`);
      if (attempt === 1) process.stdout.write("Väntar på databasen …\n");
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
  return `${error.message}${cause}`;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? fail("Sätt DATABASE_URL till den lokala databasen (se .env.example).");
  if (process.env.NODE_ENV === "production") fail("pnpm demo körs inte i produktion.");
  const { db, pool } = createDatabase(url);
  try {
    await waitForDatabase(pool);
    await migrate(db, { migrationsFolder: new URL("../packages/database/migrations", import.meta.url).pathname });

    const registered = await registerUserAccount(db, { formatVersion: 1, email: EMAIL, displayName: "Demoarrangör", password: PASSWORD });
    const account = registered.status === "conflict"
      ? await loginUserAccount(db, { formatVersion: 1, email: EMAIL, password: PASSWORD })
      : registered;
    if (account.status !== "authenticated") fail(`Kontot ${EMAIL} finns men lösenordet är ändrat. Använd en tom databas.`);
    const owner = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };

    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE }).format(new Date());
    const created = await createEventAsUserAccount(db, { ...owner, idempotencyKey: `organizer-event-create:${randomUUID()}`,
      readBody: async () => ({ formatVersion: 1, eventName: `Demoträning ${today}`, raceName: "Kvällsträning", raceDate: today, timeZone: TIME_ZONE }) });
    if (created.status !== "created") fail(`Tävlingen kunde inte skapas (${created.status}).`);
    const raceId = created.response.raceId;
    const entered = await enterRaceAsUserAccount(db, { ...owner, raceId });
    if (entered.status !== "entered") fail(`Kom inte in i tävlingen (${entered.status}).`);
    const admin = { sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken, raceId };
    const snapshotVersion = async () =>
      (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;

    const classes = [];
    for (const course of COURSES) {
      const requestId = randomUUID();
      const result = await createManualCourseClassAsAdministrator(db, { ...admin, idempotencyKey: `manual-course-class-create:${requestId}`,
        request: { formatVersion: 1, requestId, expectedSnapshotVersion: await snapshotVersion(), courseName: course.name,
          className: course.className, startRule: "PUNCH", controlCodes: [...course.controls] } });
      if (result.status !== "created") fail(`Banan ${course.name} kunde inte skapas (${result.status}).`);
      classes.push({ ...course, classId: result.response.classId, courseVersionId: result.response.courseVersionId });
    }

    const runners = [];
    for (const [index, [givenName, familyName]] of RUNNERS.entries()) {
      const raceClass = classes[index % classes.length]!;
      const cardNumber = 8_100_001 + index;
      const result = await registerEntryAsAdmin(db, { ...admin, idempotencyKey: `entry-registration:${randomUUID()}`,
        request: { formatVersion: 1, classId: raceClass.classId, expectedCourseVersionId: raceClass.courseVersionId,
          expectedStartRule: "PUNCH", expectedSnapshotVersion: await snapshotVersion(), givenName, familyName,
          organisationName: "Demo OK", cardNumber: String(cardNumber), fixedStartTime: null } });
      if (result.status !== "registered") fail(`${givenName} ${familyName} kunde inte anmälas (${result.status}).`);
      runners.push({ cardNumber, controls: raceClass.controls });
    }

    // Sju har gått i mål; löpare 4 missade en kontroll. Löpare 8–10 är kvar i skogen.
    const now = Date.now();
    const deviceId = randomUUID();
    const events: DeviceBatch["events"] = runners.slice(0, 7).map((runner, index) => {
      const startAt = new Date(now - (75 - index * 3) * 60_000);
      const finishAt = new Date(now - (35 - index * 4) * 60_000);
      const controls = index === 3 ? runner.controls.filter((code) => code !== 33) : runner.controls;
      const read = readSimulatedCard(simulatedRun(runner.cardNumber, { startAt, finishAt, controlCodes: controls, timeZone: TIME_ZONE }));
      const readAt = new Date(finishAt.getTime() + 60_000);
      const card = normalizeCard(read.card, { reference: readAt, timeZone: TIME_ZONE });
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
    const batch: DeviceBatch = { deviceId, sessionId: randomUUID(), packageVersion: await snapshotVersion(),
      firstSequence: 1, lastSequence: events.length, events };
    const ingested = await ingestReadoutsAsAdministrator(db, { ...admin, batch });
    if (ingested.status !== "ok") fail(`Avläsningarna kunde inte sparas (${ingested.status}).`);

    const origin = process.env.O_TID_PUBLIC_ORIGIN ?? "http://localhost:3000";
    process.stdout.write([
      "Demoträningen är klar.",
      `  Logga in:   ${origin}/organizer  (e-post: ${EMAIL}, lösenord: ${PASSWORD})`,
      `  Hantera:    ${origin}/admin/${raceId}/manage`,
      `  Avläsning:  ${origin}/admin/${raceId}/readout  (starta övningsstationen)`,
      `  Resultat:   ${origin}/results/${raceId}  (öppen för alla)`,
      "  10 anmälda, 7 avlästa (1 felstämplad), 3 kvar i skogen.",
      ""
    ].join("\n"));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${describe(error)}\n`);
  process.exitCode = 1;
});
