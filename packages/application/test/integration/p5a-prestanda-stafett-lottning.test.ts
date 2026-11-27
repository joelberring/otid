import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { type DeviceBatch, type SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/serialization";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { createManualCourseClassAsAdmin } from "../../src/manual-course-class";
import { ingestReadoutsAsAdmin } from "../../src/readout-station";
import { requireRaceRole, type RacePrincipal } from "../../src/race-session";
import { createRelayClassAsAdmin, registerRelayTeamAsAdmin } from "../../src/relay-admin";
import { getRelayOverviewAsAdmin } from "../../src/relay-results";
import { listSpeakerBoardAsAdmin } from "../../src/speaker-board";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { StartDrawVersionConflictError, updateDrawnEntryStartTimes } from "../../src/start-draw";
import { accountOnRace } from "./accounts";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("P5A-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_p5a_perf_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 120_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_p5a_perf_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };
const at = (clock: string) => `2026-10-08T${clock}:00.000Z`;
const CODES = [31, 32, 33];

async function createRace(raceType: "STANDARD" | "RELAY" = "RELAY"): Promise<Proof> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `p5a.${suffix}@test.o-tid.se`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "25-manna", raceName: "Lördag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm", raceType }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

async function createCourse(proof: Proof, name: string) {
  const requestId = randomUUID();
  const created = await createManualCourseClassAsAdmin(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, courseName: name, className: `Klass ${name}`, startRule: "PUNCH", controlCodes: CODES } });
  if (created.status !== "created" || !created.response.classId) throw new Error("Banan kunde inte skapas");
  return { ...created.response, classId: created.response.classId };
}

async function buildBatch(raceId: string, cardNumber: string, from: string, finish: string): Promise<DeviceBatch> {
  const fromMs = Date.parse(from), finishMs = Date.parse(finish);
  const payload: SportidentReadoutPayload = { cardNumber, cardType: "SI10", finishPunchedAt: finish,
    punches: CODES.map((code, index) => ({ code, punchedAt: new Date(fromMs + (index + 1) * (finishMs - fromMs) / (CODES.length + 1)).toISOString() })),
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true };
  const version = (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;
  return { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: version, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: new Date(finishMs + 60_000).toISOString(), transport: "sportident", payload,
      contentHash: contentHash(payload) }] };
}

async function stamp(proof: Proof, cardNumber: string, from: string, finish: string, authorized?: RacePrincipal) {
  const batch = await buildBatch(proof.raceId, cardNumber, from, finish);
  const ingested = await ingestReadoutsAsAdmin(db, { ...proof, ...(authorized ? { authorized } : {}), batch });
  if (ingested.status !== "ok" || ingested.response.acknowledgements[0]?.status !== "stored") throw new Error("Avläsningen togs inte emot");
  return ingested.response;
}

describe("Etapp P5A: stafettomstämpling, 25-manna SQL-budget, speaker och writeDraw-konflikt", { timeout: 30_000 }, () => {
  it("omordnad stafettstämpling (sträcka 2 och 3 före sträcka 1) triggar fortfarande varv 2 och ger alla tre OK", async () => {
    const proof = await createRace("RELAY");
    const { courseId } = await createCourse(proof, "Stafettbana");
    const classReqId = randomUUID();
    const relayClass = await createRelayClassAsAdmin(db, { ...proof, idempotencyKey: `relay-class:${classReqId}`, request: {
      formatVersion: 1, requestId: classReqId, name: "Stafett 3", courseId, legs: [
        { leg: 1, startMethod: "MASS_START", startTime: at("10:00"), variantCode: null },
        { leg: 2, startMethod: "CHANGEOVER", startTime: null, variantCode: null },
        { leg: 3, startMethod: "CHANGEOVER", startTime: null, variantCode: null }
      ] } });
    if (relayClass.status !== "saved") throw new Error("Stafettklassen kunde inte skapas");
    const teamReqId = randomUUID();
    const team = await registerRelayTeamAsAdmin(db, { ...proof, idempotencyKey: `relay-team:${teamReqId}`, request: {
      formatVersion: 1, requestId: teamReqId, classId: relayClass.response.classId, number: 1, name: "OK Omordnad", organisationName: "OK",
      runners: [
        { givenName: "Ett", familyName: "Lag", organisationName: null, cardNumber: "81001" },
        { givenName: "Två", familyName: "Lag", organisationName: null, cardNumber: "81002" },
        { givenName: "Tre", familyName: "Lag", organisationName: null, cardNumber: "81003" }
      ] } });
    if (team.status !== "saved") throw new Error("Laget kunde inte skapas");

    // Sträcka 2 stämplar FÖRE sträcka 1 -> saknar start (MISSING_START), men ger sträcka 3 växlingstid.
    await stamp(proof, "81002", at("10:30"), at("11:05"));
    // Sträcka 3 stämplar sedan (11:05 -> 11:40).
    await stamp(proof, "81003", at("11:05"), at("11:40"));
    // Sträcka 1 kommer in SIST (10:00 -> 10:30): varv 2 måste räkna om sträcka 2 från MISSING_START till OK (35 min)!
    await stamp(proof, "81001", at("10:00"), at("10:30"));

    const overview = await getRelayOverviewAsAdmin(db, proof);
    if (overview.status !== "ok") throw new Error("Lagvyn saknas");
    const lag = overview.response.teams.find(row => row.name === "OK Omordnad")!;
    expect(lag.status).toBe("OK");
    expect(lag.elapsedMs).toBe(100 * 60_000);
    expect(lag.legs.map(leg => [leg.leg, leg.status, leg.elapsedMs])).toEqual([
      [1, "OK", 30 * 60_000],
      [2, "OK", 35 * 60_000],
      [3, "OK", 35 * 60_000]
    ]);
  });

  it("25-manna-växling: kraftigt reducerat antal SQL-satser, noll SAVEPOINT och korrekt speaker-vy", async () => {
    const proof = await createRace("RELAY");
    const { courseId } = await createCourse(proof, "25-manna-bana");
    const classReqId = randomUUID();
    const legs = Array.from({ length: 25 }, (_, i) => ({
      leg: i + 1,
      startMethod: i === 0 ? ("MASS_START" as const) : i === 24 ? ("RESTART" as const) : ("CHANGEOVER" as const),
      startTime: i === 0 ? at("09:00") : i === 24 ? at("15:00") : null,
      variantCode: null
    }));
    const relayClass = await createRelayClassAsAdmin(db, { ...proof, idempotencyKey: `relay-class:${classReqId}`, request: {
      formatVersion: 1, requestId: classReqId, name: "25-manna", courseId, legs } });
    if (relayClass.status !== "saved") throw new Error("25-mannaklassen kunde inte skapas");
    for (let t = 1; t <= 4; t += 1) {
      const reqId = randomUUID();
      const created = await registerRelayTeamAsAdmin(db, { ...proof, idempotencyKey: `relay-team:${reqId}`, request: {
        formatVersion: 1, requestId: reqId, classId: relayClass.response.classId, number: t, name: `Lag ${t}`, organisationName: `OK ${t}`,
        runners: Array.from({ length: 25 }, (_, l) => ({
          givenName: `L${t}-${l + 1}`, familyName: "Test", organisationName: null, cardNumber: String(820_000 + t * 100 + l + 1)
        })) } });
      if (created.status !== "saved") throw new Error("Lag kunde inte skapas");
    }

    // Uppvärmning (lag 1 sträcka 1) så auto-arkivets negativa cache är varm för tävlingen.
    await stamp(proof, "820101", at("09:00"), at("09:30"));

    // Förbered batchen och verifiera behörighet 1 gång (som readoutIngestRoute gör med `authorized`).
    const auth = await requireRaceRole(db, { ...proof, role: "FUNCTIONARY", requireCsrf: true });
    if (auth.status !== "authenticated") throw new Error("Behörigheten misslyckades");
    const batch = await buildBatch(proof.raceId, "820201", at("09:00"), at("09:32"));

    // Räkna exakt antal SQL-satser för en vanlig stafettväxling (lag 2 sträcka 1 -> sätter sträcka 2:s start).
    const queries: string[] = [];
    const probe = await pool.connect();
    const clientProto = Object.getPrototypeOf(probe) as { query: (...args: unknown[]) => unknown };
    probe.release();
    const origQuery = clientProto.query;
    const spy = vi.spyOn(clientProto, "query").mockImplementation(function (this: unknown, ...args: unknown[]) {
      const first = args[0];
      const sqlText = typeof first === "string"
        ? first
        : typeof first === "object" && first !== null && "text" in first
          ? String((first as { text: unknown }).text)
          : "";
      if (sqlText) queries.push(sqlText.trim());
      return origQuery.apply(this, args);
    });

    try {
      const ingested = await ingestReadoutsAsAdmin(db, { ...proof, authorized: auth.principal, batch });
      if (ingested.status !== "ok" || ingested.response.acknowledgements[0]?.status !== "stored") {
        throw new Error("Avläsningen togs inte emot");
      }
    } finally {
      spy.mockRestore();
    }

    // Ingen SAVEPOINT på tävling utan aktivt klubbarkiv, ingen varv-2-snapshot, ingen team-sprint/loadRelayLegResults.
    expect(queries.filter(q => /^savepoint\b/i.test(q))).toHaveLength(0);
    expect(queries.filter(q => /from "course_version"/i.test(q))).toHaveLength(1);
    expect(queries.filter(q => /select distinct on/i.test(q))).toHaveLength(0);
    const statements = queries.filter(q => !/^(begin|commit|rollback)\b/i.test(q));
    // Tidigare ~75–84 SQL-satser för en vanlig 25-mannaväxling; nu <= 42 satser (post-auth ingestDeviceBatch).
    expect(statements.length).toBeLessThanOrEqual(42);

    // Speaker-board ska returnera rätt lagnummer, namn, sträcka och omstart utan att ladda full loadRelayView.
    // Stämpla också sträcka 25 (omstart) för lag 1 så omstartsflaggan verifieras!
    await stamp(proof, "820125", at("15:00"), at("15:25"));
    const speaker = await listSpeakerBoardAsAdmin(db, proof);
    if (speaker.status !== "ok") throw new Error("Speakerunderlaget saknas");
    const leg1Row = speaker.response.rows.find(row => row.givenName === "L2-1");
    expect(leg1Row?.relay).toMatchObject({ teamNumber: 2, teamName: "Lag 2", leg: 1, restarted: false });
    const leg25Row = speaker.response.rows.find(row => row.givenName === "L1-25");
    expect(leg25Row?.relay).toMatchObject({ teamNumber: 1, teamName: "Lag 1", leg: 25, restarted: true });
  });

  it("writeDraw batchad UPDATE ... FROM unnest upptäcker optimistisk versionskonflikt och rullar tillbaka allt", async () => {
    const proof = await createRace("STANDARD");
    const { classId, courseVersionId } = await createCourse(proof, "Lottbana");
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const reg = await registerEntryAsAdmin(db, { ...proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
        formatVersion: 1, classId, expectedCourseVersionId: courseVersionId, expectedStartRule: "PUNCH",
        givenName: `Löpare${i}`, familyName: "Konflikt", organisationName: "OK", cardNumber: null, fixedStartTime: null } });
      if (reg.status !== "registered") throw new Error("Anmälan misslyckades");
      ids.push(reg.response.entryId);
    }

    // Höj versionen på en av deltagarna (simulerar samtidig ändring).
    await db.update(schema.entries).set({ version: 2 }).where(eq(schema.entries.id, ids[1]!));

    await expect(db.transaction(tx => updateDrawnEntryStartTimes(tx, proof.raceId, [
      { id: ids[0]!, fixedStartTime: at("10:00"), expectedVersion: 1 },
      { id: ids[1]!, fixedStartTime: at("10:02"), expectedVersion: 1 },
      { id: ids[2]!, fixedStartTime: at("10:04"), expectedVersion: 1 }
    ]))).rejects.toBeInstanceOf(StartDrawVersionConflictError);

    // Hela transaktionen rullades tillbaka: ingen av deltagarna fick ny starttid eller höjd version.
    const afterConflict = await db.select({ id: schema.entries.id, fixedStartTime: schema.entries.fixedStartTime, version: schema.entries.version })
      .from(schema.entries).where(eq(schema.entries.raceId, proof.raceId));
    const byId = new Map(afterConflict.map(row => [row.id, row]));
    expect(byId.get(ids[0]!)!.fixedStartTime).toBeNull();
    expect(byId.get(ids[0]!)!.version).toBe(1);
    expect(byId.get(ids[1]!)!.fixedStartTime).toBeNull();
    expect(byId.get(ids[1]!)!.version).toBe(2);
    expect(byId.get(ids[2]!)!.fixedStartTime).toBeNull();
    expect(byId.get(ids[2]!)!.version).toBe(1);

    // Med korrekta versioner uppdateras alla tre atomiskt (inkl. null för fri start).
    await db.transaction(tx => updateDrawnEntryStartTimes(tx, proof.raceId, [
      { id: ids[0]!, fixedStartTime: at("10:00"), expectedVersion: 1 },
      { id: ids[1]!, fixedStartTime: null, expectedVersion: 2 },
      { id: ids[2]!, fixedStartTime: at("10:04"), expectedVersion: 1 }
    ]));
    const afterOk = await db.select({ id: schema.entries.id, fixedStartTime: schema.entries.fixedStartTime, version: schema.entries.version })
      .from(schema.entries).where(eq(schema.entries.raceId, proof.raceId));
    const okById = new Map(afterOk.map(row => [row.id, row]));
    expect(okById.get(ids[0]!)!.fixedStartTime?.toISOString()).toBe(at("10:00"));
    expect(okById.get(ids[0]!)!.version).toBe(2);
    expect(okById.get(ids[1]!)!.fixedStartTime).toBeNull();
    expect(okById.get(ids[1]!)!.version).toBe(3);
    expect(okById.get(ids[2]!)!.fixedStartTime?.toISOString()).toBe(at("10:04"));
    expect(okById.get(ids[2]!)!.version).toBe(2);
  });
});
