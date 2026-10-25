import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { DeviceBatch, SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/serialization";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { createManualCourseClassAsAdmin } from "../../src/manual-course-class";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { ingestReadoutsAsAdmin } from "../../src/readout-station";
import { getAdministratorEffectiveResult } from "../../src/administrator-effective-result";
import { statusFlow } from "./entry-status-helpers";
import { editCourseAsAdmin, listCoursesForEditAsAdmin, previewCourseEditAsAdmin } from "../../src/course-edit";
import { listEntryTransfersAsAdmin } from "../../src/entry-transfer";
import { accountOnRace } from "./accounts";
import { registerReadoutCard } from "../../src/readout-registration";
import { publicResults } from "../../src/results";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("ADR-0169-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0169_edit_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0169_edit_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };
type Race = { proof: Proof; raceId: string; classId: string; courseId: string };

async function snapshot(raceId: string): Promise<number> {
  return (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;
}

async function courseVersionOf(classId: string): Promise<string> {
  return (await pool.query<{ course_version_id: string }>("select course_version_id from class where id = $1", [classId])).rows[0]!.course_version_id;
}

async function race(controlCodes: number[]): Promise<Race> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `bana.${suffix}@test.o-tid.se`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Klubbträning", raceName: "Torsdag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const { raceId } = created.response;
  const entered = await accountOnRace(db, { ...accountProof, raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  const proof: Proof = { raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
  const requestId = randomUUID();
  const course = await createManualCourseClassAsAdmin(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, courseName: "Lång",
      className: "H21", startRule: "PUNCH", controlCodes } });
  if (course.status !== "created") throw new Error(`Banan kunde inte skapas: ${course.status}`);
  return { proof, raceId, classId: course.response.classId, courseId: course.response.courseId };
}

async function register(f: Race, givenName: string, cardNumber: string): Promise<string> {
  const registered = await registerEntryAsAdmin(db, { ...f.proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
    formatVersion: 1, classId: f.classId, expectedCourseVersionId: await courseVersionOf(f.classId), expectedStartRule: "PUNCH",
    givenName, familyName: "Löpare", organisationName: null,
    cardNumber, fixedStartTime: null } });
  if (registered.status !== "registered") throw new Error(`Anmälan misslyckades: ${registered.status}`);
  return registered.response.entryId;
}

async function readout(f: Race, cardNumber: string, codes: number[]) {
  const payload: SportidentReadoutPayload = {
    cardNumber, cardType: "SI10", startPunchedAt: "2026-10-08T16:00:00.000Z", finishPunchedAt: "2026-10-08T16:30:00.000Z",
    punches: codes.map((code, index) => ({ code, punchedAt: `2026-10-08T16:${String(5 + index * 5).padStart(2, "0")}:00.000Z` })),
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true
  };
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: await snapshot(f.raceId),
    firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-10-08T16:31:00.000Z", transport: "sportident", payload, contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdmin(db, { ...f.proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
}

async function effective(f: Race, entryId: string) {
  const result = await getAdministratorEffectiveResult(db, { ...f.proof, entryId });
  if (result.status !== "ok" || result.response.state !== "ACTIVE_RESULT") throw new Error("Gällande resultat saknas");
  return { status: result.response.result.status, current: result.response.resultCurrent };
}

async function edit(f: Race, controlCodes: number[], confirmResultChanges: boolean) {
  const requestId = randomUUID();
  const request = { formatVersion: 1, requestId,
    courseId: f.courseId, controlCodes, confirmResultChanges };
  return { request, result: await editCourseAsAdmin(db, { ...f.proof, idempotencyKey: `course-edit:${requestId}`, request }) };
}

const revisions = async (entryId: string) => (await pool.query<{ revision: number; status: string; cause: string }>(
  "select revision, status, cause from result_revision where entry_id = $1 order by revision", [entryId])).rows;

describe("ADR-0169 Redigera bana", () => {
  it("stryker en kontroll efter avläsning: besked, bekräftelse och omräkning i samma transaktion", async () => {
    const f = await race([31, 32, 33]);
    const ada = await register(f, "Ada", "7001");
    const bo = await register(f, "Bo", "7002");
    await register(f, "Cecilia", "7003");
    await readout(f, "7001", [31, 32, 33]);
    await readout(f, "7002", [31, 33]);
    expect(await effective(f, bo)).toEqual({ status: "MP", current: true });
    const readoutsBefore = (await pool.query("select * from card_readout where race_id = $1 order by id", [f.raceId])).rows;

    const listed = await listCoursesForEditAsAdmin(db, f.proof);
    if (listed.status !== "ok") throw new Error("Banlistan saknas");
    expect(listed.response.courses).toEqual([{ courseId: f.courseId, courseVersionId: await courseVersionOf(f.classId), name: "Lång", controlCodes: [31, 32, 33],
      lengthMeters: null, climbMeters: null,
      classes: [{ classId: f.classId, name: "H21" }], entryCount: 3, readOutCount: 2, variants: [], unevenLegs: [] }]);

    const preview = await previewCourseEditAsAdmin(db, { ...f.proof, courseId: f.courseId,
      request: { formatVersion: 1, controlCodes: [31, 33] } });
    if (preview.status !== "ok") throw new Error(`Beskedet saknas: ${preview.status}`);
    expect(preview.response).toMatchObject({ readOutCount: 2, becomesOkCount: 1, becomesMispunchedCount: 0, unchangedCount: 1,
      notRecalculatedCount: 0, requiresConfirmation: true,
      changes: [{ entryId: bo, displayName: "Bo Löpare", className: "H21", before: "MP", after: "OK" }] });

    const unconfirmed = await edit(f, [31, 33], false);
    expect(unconfirmed.result.status).toBe("confirmation-required");
    const before = await snapshot(f.raceId);
    const previousVersion = await courseVersionOf(f.classId);
    const saved = await edit(f, [31, 33], true);
    if (saved.result.status !== "edited") throw new Error(`Ändringen sparades inte: ${saved.result.status}`);
    expect(saved.result.response.recalculated.map(item => item.entryId).sort()).toEqual([ada, bo].sort());
    expect(await snapshot(f.raceId)).toBe(before + 1);
    expect(await courseVersionOf(f.classId)).not.toBe(previousVersion);

    expect(await effective(f, ada)).toEqual({ status: "OK", current: true });
    expect(await effective(f, bo)).toEqual({ status: "OK", current: true });
    expect(await revisions(bo)).toEqual([{ revision: 1, status: "MP", cause: "CARD_READOUT" },
      { revision: 2, status: "OK", cause: "EXPLICIT_RECALCULATION" }]);
    expect((await pool.query("select * from card_readout where race_id = $1 order by id", [f.raceId])).rows).toEqual(readoutsBefore);

    // Samma begäran igen ger samma kvitto utan nya revisioner.
    const replay = await editCourseAsAdmin(db, { ...f.proof, idempotencyKey: `course-edit:${saved.request.requestId}`, request: saved.request });
    expect(replay).toEqual({ status: "edited", response: { ...saved.result.response, replayed: true } });
    expect(await revisions(bo)).toHaveLength(2);
  });

  it("sparar direkt när ingen har läst ut", async () => {
    const f = await race([31, 32, 33]);
    await register(f, "Ada", "7101");
    const preview = await previewCourseEditAsAdmin(db, { ...f.proof, courseId: f.courseId,
      request: { formatVersion: 1, controlCodes: [33, 32, 31, 34] } });
    if (preview.status !== "ok") throw new Error("Beskedet saknas");
    expect(preview.response).toMatchObject({ readOutCount: 0, requiresConfirmation: false, changes: [] });
    const saved = await edit(f, [33, 32, 31, 34], false);
    if (saved.result.status !== "edited") throw new Error(`Ändringen sparades inte: ${saved.result.status}`);
    expect(saved.result.response.recalculated).toEqual([]);
    const codes = await pool.query<{ code: number }>(`select ctl.code from course_control cc join control ctl on ctl.id = cc.control_id
      where cc.course_version_id = $1 order by cc.sequence`, [await courseVersionOf(f.classId)]);
    expect(codes.rows.map(row => row.code)).toEqual([33, 32, 31, 34]);
    // Oförändrad kontrollföljd är ingen ändring.
    expect((await edit(f, [33, 32, 31, 34], false)).result.status).toBe("invalid-request");
  });

  it("ett manuellt diskbeslut gäller fortsatt efter ändringen", async () => {
    const f = await race([31, 32, 33]);
    const ada = await register(f, "Ada", "7301");
    await readout(f, "7301", [31, 32, 33]);
    const [source] = (await pool.query<{ id: string; revision: number }>("select id, revision from result_revision where entry_id = $1", [ada])).rows;
    const disqualified = await statusFlow(db).decide({ ...f.proof, raceId: f.raceId }, ada, { kind: "DISQUALIFIED" },
      { expectedRevision: source!.revision });
    expect(disqualified.status).toBe("decided");
    expect(await effective(f, ada)).toMatchObject({ status: "DSQ" });

    // Ada stämplade inte 34, men disken gäller ändå: inget resultat byter status, så det sparas utan bekräftelse.
    const preview = await previewCourseEditAsAdmin(db, { ...f.proof, courseId: f.courseId,
      request: { formatVersion: 1, controlCodes: [31, 32, 33, 34] } });
    if (preview.status !== "ok") throw new Error("Beskedet saknas");
    expect(preview.response).toMatchObject({ readOutCount: 1, unchangedCount: 1, requiresConfirmation: false });
    const saved = await edit(f, [31, 32, 33, 34], false);
    if (saved.result.status !== "edited") throw new Error(`Ändringen sparades inte: ${saved.result.status}`);
    expect(saved.result.response.recalculated).toHaveLength(1);
    // Disken gäller och vilar på en omräknad teknisk revision: resultatet är aktuellt, inte "äldre underlag".
    expect(await effective(f, ada)).toEqual({ status: "DSQ", current: true });
    const roster = await listEntryTransfersAsAdmin(db, f.proof);
    if (roster.status !== "ok") throw new Error("Deltagarlistan saknas");
    expect(roster.response.entries.find(row => row.id === ada)?.resultFreshness).toBe("CURRENT_SNAPSHOT");
    // Den tekniska revisionen är omräknad mot den nya banan och disken följer med (steg 44).
    expect((await revisions(ada)).slice(-3)).toEqual([{ revision: 3, status: "MP", cause: "EXPLICIT_RECALCULATION" },
      { revision: 4, status: "MP", cause: "MANUAL_DISQUALIFICATION_WITHDRAWAL" },
      { revision: 5, status: "DSQ", cause: "MANUAL_DISQUALIFICATION" }]);
    const [basis] = (await pool.query<{ current: boolean }>(`select basis_hash = otid_result_basis_hash(entry_id) as current
      from result_revision where entry_id = $1 order by revision desc limit 1`, [ada])).rows;
    expect(basis?.current).toBe(true);
  });
});

describe("steg 31 (B4): samma bricka hos två löpare och banändring", () => {
  it("räknar om var och en från sin egen avläsning; inget resultat flyttas mellan löparna", async () => {
    const f = await race([31, 32, 33]);
    const ada = await register(f, "Ada", "8101");
    await readout(f, "8101", [31, 32, 33]);
    // Lina lånar Adas bricka och springer efteråt (17:00–17:40) men missar 32.
    const payload: SportidentReadoutPayload = { cardNumber: "8101", cardType: "SI10", startPunchedAt: "2026-10-08T17:00:00.000Z",
      finishPunchedAt: "2026-10-08T17:40:00.000Z", punches: [31, 33].map((code, index) => ({ code,
        punchedAt: `2026-10-08T17:${String(10 + index * 10)}:00.000Z` })), untimedPunchCodes: [], frames: ["02ef8300"], simulated: true };
    const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: await snapshot(f.raceId),
      firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-10-08T17:41:00.000Z", transport: "sportident",
        payload, contentHash: contentHash(payload) }] };
    const ingested = await ingestReadoutsAsAdmin(db, { ...f.proof, batch });
    expect(ingested).toMatchObject({ status: "ok", response: { acknowledgements: [{ serverResult: { status: "UNKNOWN_CARD" } }] } });
    const requestId = randomUUID();
    const registered = await registerReadoutCard(db, { ...f.proof, idempotencyKey: `readout-registration:${requestId}`, request: {
      formatVersion: 1, requestId, cardNumber: "8101", classId: f.classId, givenName: "Lina", familyName: "Lånad",
      organisationName: null, borrowedCard: true } });
    if (registered.status !== "registered") throw new Error(registered.status);
    const lina = registered.response.entryId;
    expect(await effective(f, ada)).toMatchObject({ status: "OK" });
    expect(await effective(f, lina)).toMatchObject({ status: "MP" });

    // Kontroll 32 tas bort ur banan: Lina blir godkänd, Ada förblir godkänd, var och en med sin avläsning.
    const { result } = await edit(f, [31, 33], true);
    expect(result.status).toBe("edited");
    expect(await effective(f, ada)).toMatchObject({ status: "OK", current: true });
    expect(await effective(f, lina)).toMatchObject({ status: "OK", current: true });
    const latest = async (entryId: string) => (await pool.query<{ readout_id: string; elapsed: number }>(
      "select readout_id, (evaluation->>'elapsedMs')::int as elapsed from result_revision where entry_id = $1 order by revision desc limit 1",
      [entryId])).rows[0]!;
    const [adaLatest, linaLatest] = [await latest(ada), await latest(lina)];
    expect(adaLatest.readout_id).not.toBe(linaLatest.readout_id);
    expect([adaLatest.elapsed, linaLatest.elapsed]).toEqual([30 * 60_000, 40 * 60_000]);
  });
});

describe("steg 44: manuella beslut följer med när banan redigeras", () => {
  it("behåller placeringarna och låter klassen fastställas med manuell tid och godkänd i klassen", async () => {
    const f = await race([31, 32, 33]);
    await register(f, "Ada", "9101");
    const bo = await register(f, "Bo", "9102");
    const cia = await register(f, "Cia", "9103");
    const dan = await register(f, "Dan", "9104");
    await readout(f, "9101", [31, 32, 33]);
    await readout(f, "9102", [31, 32, 33]);
    await readout(f, "9103", [31, 33]);
    await readout(f, "9104", [31, 32, 33]);
    const flow = statusFlow(db);
    const auth = { ...f.proof, raceId: f.raceId };
    // Bo: målstämplingen var fel, arrangören satte manuell tid 35 min. Cia: missade 32, godkänd av arrangören.
    expect((await flow.decide(auth, bo, { kind: "MANUAL_TIME", status: "OK", finishTime: "2026-10-08T16:35:00.000Z",
      note: "Målenheten gick fel" })).status).toBe("decided");
    expect((await flow.decide(auth, cia, { kind: "APPROVE_MANUALLY", note: "Kontrollen var borta" })).status).toBe("decided");
    // Dan: brutit med sträcktider.
    expect((await flow.decide(auth, dan, { kind: "DID_NOT_FINISH", note: "Bröt" })).status).toBe("decided");

    const preview = await previewCourseEditAsAdmin(db, { ...f.proof, courseId: f.courseId,
      request: { formatVersion: 1, controlCodes: [31, 33, 32] } });
    if (preview.status !== "ok") throw new Error("Beskedet saknas");
    expect(preview.response).toMatchObject({ readOutCount: 4, manualDecisionCount: 3, notRecalculatedCount: 0 });
    // Ada stämplade 32 före 33: med den nya ordningen blir hon felstämplad, och Bo likaså under sitt beslut.
    const saved = await edit(f, [31, 33, 32], true);
    if (saved.result.status !== "edited") throw new Error(`Ändringen sparades inte: ${saved.result.status}`);
    expect(await effective(f, bo)).toEqual({ status: "OK", current: true });
    expect(await effective(f, cia)).toEqual({ status: "OK", current: true });
    expect(await effective(f, dan)).toEqual({ status: "DNF", current: true });
    const courseVersionId = await courseVersionOf(f.classId);
    const heads = (await pool.query<{ entry_id: string; cause: string; course_version_id: string; elapsed: number | null }>(
      `select distinct on (entry_id) entry_id, cause, course_version_id, (evaluation->>'elapsedMs')::int as elapsed
       from result_revision where race_id = $1 order by entry_id, revision desc`, [f.raceId])).rows;
    expect(heads.every(row => row.course_version_id === courseVersionId)).toBe(true);
    expect(heads.find(row => row.entry_id === bo)).toMatchObject({ cause: "MANUAL_TIME", elapsed: 35 * 60_000 });

    const list = await publicResults(db, f.raceId);
    if (list.formatVersion !== 7) throw new Error("Fel format");
    const ranked = list.results.flatMap(row => row.rankingState === "RANKED" && "position" in row ? [[row.givenName, row.position]] : []);
    expect(ranked).toEqual([["Cia", 1], ["Bo", 2]]);
    expect(list.results.some(row => row.rankingState === "MIXED_COURSE_VERSIONS")).toBe(false);

    // "Resultaten är klara": klassen och loppet kan fastställas.
    expect(await flow.finalizeAll(auth)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
