import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { DeviceBatch, SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/hash";
import { createEventAsUserAccount, enterRaceAsUserAccount } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { ingestReadoutsAsAdministrator, readReadoutPackageAsAdministrator } from "../../src/readout-station";
import { getAdministratorEffectiveResult } from "../../src/administrator-effective-result";
import { listCoursesForEditAsAdministrator } from "../../src/course-edit";
import { changeRogainingAsAdministrator, previewRogainingChangeAsAdministrator } from "../../src/rogaining";
import { publicResults } from "../../src/results";
import { exportIofResultListAsAdmin } from "../../src/result-list-export";

/**
 * ADR-0170 beslut 5 / PLAN.md steg 15: rogaining. Avläsningen ger poäng, straff och summa; resultatlistan
 * sorteras på poäng och tid; ändrade poäng räknar om resultaten med nya revisioner och märks i underlaget.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Rogainingtestet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0170_rogaining_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0170_rogaining_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };
type Race = { proof: Proof; raceId: string; classId: string };

const snapshot = async (raceId: string) =>
  (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;
const courseVersionOf = async (classId: string) =>
  (await pool.query<{ course_version_id: string }>("select course_version_id from class where id = $1", [classId])).rows[0]!.course_version_id;

async function race(controlCodes: number[]): Promise<Race> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, loginName: `rogaining.${suffix}`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createEventAsUserAccount(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Poängjakt", raceName: "Torsdag", raceDate: "2026-10-08",
      timeZone: "Europe/Stockholm", raceType: "ROGAINING" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const { raceId } = created.response;
  const entered = await enterRaceAsUserAccount(db, { ...accountProof, raceId });
  if (entered.status !== "entered") throw new Error("Kom inte in i tävlingen");
  const proof: Proof = { raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
  const requestId = randomUUID();
  const course = await createManualCourseClassAsAdministrator(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, expectedSnapshotVersion: await snapshot(raceId), courseName: "Kontroller",
      className: "Rogaining 60", startRule: "PUNCH", controlCodes, rogaining: { timeLimitMinutes: 60, penaltyPoints: 2 } } });
  if (course.status !== "created") throw new Error(`Banan kunde inte skapas: ${course.status}`);
  return { proof, raceId, classId: course.response.classId };
}

async function register(f: Race, givenName: string, cardNumber: string): Promise<string> {
  const registered = await registerEntryAsAdmin(db, { ...f.proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
    formatVersion: 1, classId: f.classId, expectedCourseVersionId: await courseVersionOf(f.classId), expectedStartRule: "PUNCH",
    expectedSnapshotVersion: await snapshot(f.raceId), givenName, familyName: "Löpare", organisationName: null,
    cardNumber, fixedStartTime: null } });
  if (registered.status !== "registered") throw new Error(`Anmälan misslyckades: ${registered.status}`);
  return registered.response.entryId;
}

const at = (minute: number, second = 0) => new Date(Date.UTC(2026, 9, 8, 16, minute, second)).toISOString();

async function readout(f: Race, cardNumber: string, punches: [number, number][], finish: string) {
  const payload: SportidentReadoutPayload = {
    cardNumber, cardType: "SI10", startPunchedAt: at(0), finishPunchedAt: finish,
    punches: punches.map(([code, minute]) => ({ code, punchedAt: at(minute) })),
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true
  };
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: await snapshot(f.raceId),
    firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: at(59), transport: "sportident", payload, contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdministrator(db, { ...f.proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
}

async function effective(f: Race, entryId: string) {
  const result = await getAdministratorEffectiveResult(db, { ...f.proof, entryId });
  if (result.status !== "ok" || result.response.state !== "ACTIVE_RESULT") throw new Error("Gällande resultat saknas");
  return { status: result.response.result.status, current: result.response.resultCurrent };
}

const revisions = async (entryId: string) => (await pool.query<{ revision: number; cause: string; total: number | null }>(
  "select revision, cause, (evaluation->'rogaining'->>'total')::int as total from result_revision where entry_id = $1 order by revision",
  [entryId])).rows;

async function change(f: Race, body: { controlPoints?: { code: number; points: number }[];
  classRules?: { classId: string; timeLimitMinutes: number; penaltyPoints: number }[] }, confirmResultChanges: boolean) {
  const requestId = randomUUID();
  const request = { formatVersion: 1, requestId, expectedSnapshotVersion: await snapshot(f.raceId), controlPoints: body.controlPoints ?? [],
    classRules: body.classRules ?? [], confirmResultChanges };
  return { request, result: await changeRogainingAsAdministrator(db, { ...f.proof, idempotencyKey: `rogaining-change:${requestId}`, request }) };
}

describe("ADR-0170 rogaining", () => {
  it("bedömer avläsningar på poäng och räknar om när en kontrolls poäng ändras", async () => {
    const f = await race([31, 45, 52, 61]);
    const ada = await register(f, "Ada", "7101");
    const bo = await register(f, "Bo", "7102");
    // Ada: tre kontroller på 50 minuter (3 + 4 + 5). Bo: dubbelstämplad 31, okänd 99 och 61:01 i mål (två påbörjade minuter).
    await readout(f, "7101", [[31, 10], [45, 20], [52, 30]], at(50));
    await readout(f, "7102", [[31, 10], [31, 11], [99, 15], [45, 30]], at(61, 1));
    expect(await effective(f, ada)).toEqual({ status: "OK", current: true });
    expect(await revisions(ada)).toEqual([{ revision: 1, cause: "CARD_READOUT", total: 12 }]);
    expect(await revisions(bo)).toEqual([{ revision: 1, cause: "CARD_READOUT", total: 3 }]);

    // Avläsningens paket bär poäng och regler så att offlinebeskedet blir rätt.
    const pkg = await readReadoutPackageAsAdministrator(db, { raceId: f.raceId, sessionToken: f.proof.sessionToken });
    if (pkg.status !== "ok") throw new Error("Paketet saknas");
    expect(pkg.response.raceSnapshot.classes[0]!.rogaining).toEqual({ timeLimitSeconds: 3_600, penaltyPointsPerMinute: 2 });

    const listed = await listCoursesForEditAsAdministrator(db, f.proof);
    if (listed.status !== "ok") throw new Error("Banlistan saknas");
    expect(listed.response.rogaining).toEqual({
      controls: [{ code: 31, points: 3, defaultPoints: 3 }, { code: 45, points: 4, defaultPoints: 4 }, { code: 52, points: 5, defaultPoints: 5 },
        { code: 61, points: 6, defaultPoints: 6 }],
      classes: [{ classId: f.classId, rules: { timeLimitMinutes: 60, penaltyPoints: 2 } }] });

    const listedBefore = await publicResults(db, f.raceId);
    expect(listedBefore.results.map(row => [row.givenName, "position" in row ? row.position : undefined,
      "rogaining" in row ? row.rogaining?.total : undefined])).toEqual([["Ada", 1, 12], ["Bo", 2, 3]]);
    expect(listedBefore.results[1]).toMatchObject({ rogaining: { controlPoints: 7, penalty: 4, overtimeMinutes: 2 }, extraPunches: [99] });
    expect(listedBefore.results[0]).not.toHaveProperty("timeBehindMs");

    // 61 har ingen besökt: sparas direkt utan bekräftelse, men alla avlästa räknas om (underlaget ändras).
    const unvisited = await change(f, { controlPoints: [{ code: 61, points: 9 }] }, false);
    if (unvisited.result.status !== "changed") throw new Error(`Poängen sparades inte: ${unvisited.result.status}`);
    expect(unvisited.result.response.recalculated).toHaveLength(2);

    // 45 ger nu 10 poäng: Ada 18, Bo 13 − 4 = 9. Beskedet kräver bekräftelse.
    const before = await snapshot(f.raceId);
    const preview = await previewRogainingChangeAsAdministrator(db, { ...f.proof,
      request: { formatVersion: 1, expectedSnapshotVersion: before, controlPoints: [{ code: 45, points: 10 }], classRules: [] } });
    if (preview.status !== "ok") throw new Error(`Beskedet saknas: ${preview.status}`);
    expect(preview.response).toMatchObject({ readOutCount: 2, notRecalculatedCount: 0, requiresConfirmation: true, changes: [
      { entryId: ada, displayName: "Ada Löpare", before: { status: "OK", total: 12 }, after: { status: "OK", total: 18 } },
      { entryId: bo, displayName: "Bo Löpare", before: { status: "OK", total: 3 }, after: { status: "OK", total: 9 } }] });
    expect((await change(f, { controlPoints: [{ code: 45, points: 10 }] }, false)).result.status).toBe("confirmation-required");
    const saved = await change(f, { controlPoints: [{ code: 45, points: 10 }] }, true);
    if (saved.result.status !== "changed") throw new Error(`Ändringen sparades inte: ${saved.result.status}`);
    expect(await snapshot(f.raceId)).toBe(before + 1);
    expect(saved.result.response.recalculated.map(item => item.entryId).sort()).toEqual([ada, bo].sort());
    expect(await revisions(ada)).toEqual([{ revision: 1, cause: "CARD_READOUT", total: 12 },
      { revision: 2, cause: "EXPLICIT_RECALCULATION", total: 12 }, { revision: 3, cause: "EXPLICIT_RECALCULATION", total: 18 }]);
    expect(await effective(f, bo)).toEqual({ status: "OK", current: true });
    expect((await pool.query("select points from control where race_id = $1 and code = 45", [f.raceId])).rows).toEqual([{ points: 10 }]);

    // Samma begäran igen ger samma kvitto.
    const replay = await changeRogainingAsAdministrator(db, { ...f.proof, idempotencyKey: `rogaining-change:${saved.request.requestId}`,
      request: saved.request });
    expect(replay).toMatchObject({ status: "changed", response: { replayed: true, requestId: saved.request.requestId } });

    // Tillbaka till förvalet sparas som förval.
    const reset = await change(f, { controlPoints: [{ code: 61, points: 6 }] }, true);
    expect(reset.result.status).toBe("changed");
    expect((await pool.query("select points from control where race_id = $1 and code = 61", [f.raceId])).rows).toEqual([{ points: null }]);

    // Längre tidsgräns: Bo blir inte sen längre.
    const longer = await change(f, { classRules: [{ classId: f.classId, timeLimitMinutes: 90, penaltyPoints: 2 }] }, true);
    expect(longer.result.status).toBe("changed");
    const listedAfter = await publicResults(db, f.raceId);
    expect(listedAfter.results.map(row => [row.givenName, "rogaining" in row ? row.rogaining?.total : undefined])).toEqual([["Ada", 18], ["Bo", 13]]);

    // IOF-exporten bär summan som Score.
    const exportLogin = { raceId: f.raceId, sessionToken: f.proof.sessionToken };
    const exported = await exportIofResultListAsAdmin(db, exportLogin);
    if (exported.status !== "ok") throw new Error(`Exporten misslyckades: ${exported.status}`);
    const xml = new TextDecoder().decode(exported.bytes);
    expect(xml).toContain('<Score type="Score">18</Score>');
    expect(xml).toContain("<Position>1</Position>");

    // Underlaget tar med poängen: en ändring förbi appen gör resultatet inaktuellt.
    await pool.query("update control set points = 1 where race_id = $1 and code = 31", [f.raceId]);
    expect(await effective(f, ada)).toEqual({ status: "OK", current: false });
  });

  it("avvisar okända kontroller och ändringar som inte ändrar något", async () => {
    const f = await race([31, 45]);
    expect((await change(f, { controlPoints: [{ code: 77, points: 3 }] }, true)).result.status).toBe("invalid-request");
    expect((await change(f, { controlPoints: [{ code: 31, points: 3 }] }, true)).result.status).toBe("invalid-request");
    expect((await change(f, { classRules: [{ classId: f.classId, timeLimitMinutes: 60, penaltyPoints: 2 }] }, true)).result.status)
      .toBe("invalid-request");
  });
});
