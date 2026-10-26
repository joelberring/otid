import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { DeviceBatch, SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/serialization";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { importIofXmlAsAdmin } from "../../src/import-iof";
import { ingestReadoutsAsAdmin } from "../../src/readout-station";
import { publicResultDetail, publicResults } from "../../src/results";
import { loadCourseSecrecy, setCoursesPublicAsAdmin } from "../../src/course-secrecy";
import { listEntryTransfersAsAdmin } from "../../src/entry-transfer";
import { markRemainingDidNotStartAsAdmin } from "../../src/remaining-runners";
import { setResultsOfficialAsAdmin } from "../../src/result-official";
import { accountOnRace } from "./accounts";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Steg 52-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg52_hemlig_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixture = (name: string) => readFileSync(new URL(`../../../../fixtures/iof/${name}`, import.meta.url));

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_steg52_hemlig_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

// Fjärilarna i course-data-forked.xml: centrum 50 med slingorna A (41 42) och B (43 44), centrum 60 med C (61 62) och D (63 64).
const loops = { A: [50, 41, 42], B: [50, 43, 44], C: [60, 61, 62], D: [60, 63, 64] } as const;
function variantCodes(code: "AC" | "AD" | "BC" | "BD"): number[] {
  const first = code[0] as "A" | "B", second = code[1] as "C" | "D";
  return [31, ...loops[first], ...loops[first === "A" ? "B" : "A"], 50, 32, ...loops[second], ...loops[second === "C" ? "D" : "C"], 60, 33];
}

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

async function snapshot(raceId: string): Promise<number> {
  return (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;
}

async function race(): Promise<Proof> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `hemlig.${suffix}@test.o-tid.se`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Klubbträning", raceName: "Torsdag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const { raceId } = created.response;
  const entered = await accountOnRace(db, { ...accountProof, raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

async function importFile(proof: Proof, name: string) {
  const result = await importIofXmlAsAdmin(db, { ...proof, idempotencyKey: `iof-import:${randomUUID()}`, xmlBytes: fixture(name) });
  if (result.status !== "stored") throw new Error(`Importen misslyckades: ${result.status}`);
  return result.response.report;
}

async function entryIds(raceId: string): Promise<Record<string, string>> {
  const rows = (await pool.query<{ id: string; given_name: string }>("select id, given_name from entry where race_id = $1", [raceId])).rows;
  return Object.fromEntries(rows.map(row => [row.given_name, row.id]));
}


async function readout(proof: Proof, cardNumber: string, codes: readonly number[]) {
  const payload: SportidentReadoutPayload = {
    cardNumber, cardType: "SI10", startPunchedAt: "2026-10-08T16:00:00.000Z", finishPunchedAt: "2026-10-08T17:00:00.000Z",
    punches: codes.map((code, index) => ({ code, punchedAt: new Date(Date.parse("2026-10-08T16:01:00.000Z") + index * 60_000).toISOString() })),
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true
  };
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: await snapshot(proof.raceId),
    firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-10-08T17:01:00.000Z", transport: "sportident", payload, contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdmin(db, { ...proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
}


const forkingOf = async (raceId: string, options: { staff?: boolean } = {}) => {
  const listed = await publicResults(db, raceId, options);
  return "classCourses" in listed ? listed.classCourses?.find(row => row.className === "H21")?.forking : undefined;
};
async function markDidNotStart(proof: Proof, entryIds: string[]) {
  const requestId = randomUUID();
  return (await markRemainingDidNotStartAsAdmin(db, { ...proof, idempotencyKey: `remaining-did-not-start:${requestId}`,
    request: { formatVersion: 1, requestId, entryIds } })).status;
}
const publicIdOf = async (entryId: string) =>
  (await pool.query<{ public_result_id: string }>("select public_result_id from entry where id = $1", [entryId])).rows[0]!.public_result_id;

describe("steg 52: banhemlighet", () => {
  it("visar gafflingsbilden publikt först när alla har resultat, resultaten är klara eller arrangören valt det", async () => {
    const proof = await race();
    await importFile(proof, "course-data-forked.xml");
    await importFile(proof, "entry-list-forked.xml");
    await importFile(proof, "course-assignment-forked.xml");
    const ids = await entryIds(proof.raceId);
    await readout(proof, "8101003", variantCodes("AD"));

    // Under tävlingen: ingen gafflingsbild publikt, men variantkoden och sträcktiderna med kontrollkoder står kvar.
    expect(await loadCourseSecrecy(db, proof.raceId)).toMatchObject({ public: false, reason: null, remaining: 6 });
    expect(await forkingOf(proof.raceId)).toBeUndefined();
    const published = await publicResults(db, proof.raceId);
    expect(JSON.stringify(published)).not.toMatch(/"forking"|latitude|longitude/);
    const cia = published.results.find(row => "publicResultId" in row && row.givenName === "Cia");
    expect(cia).toMatchObject({ courseVariantCode: "AD", splits: expect.arrayContaining([expect.objectContaining({ controlCode: 41 })]) as unknown });
    const detail = await publicResultDetail(db, proof.raceId, await publicIdOf(ids.Cia!));
    expect(detail.status === "ok" && detail.response.classCourse).toBeFalsy();
    // Arrangören och funktionärerna ser allt.
    expect((await forkingOf(proof.raceId, { staff: true }))?.items).toHaveLength(5);
    const staffDetail = await publicResultDetail(db, proof.raceId, await publicIdOf(ids.Cia!), { staff: true });
    expect(staffDetail).toMatchObject({ status: "ok", response: { classCourse: { className: "H21", forking: { items: expect.any(Array) as unknown } } } });

    // "Visa banorna publikt nu" med auditpost; samma val igen ändrar inget, och valet går att ångra.
    const revealed = await setCoursesPublicAsAdmin(db, { ...proof, reveal: true });
    expect(revealed).toMatchObject({ status: "saved", response: { courseSecrecy: { public: true, reason: "REVEALED", remaining: 6 } } });
    expect(await setCoursesPublicAsAdmin(db, { ...proof, reveal: true })).toMatchObject({ status: "saved" });
    expect((await forkingOf(proof.raceId))?.items).toHaveLength(5);
    const workspace = await listEntryTransfersAsAdmin(db, proof);
    expect(workspace.status === "ok" && workspace.response.courseSecrecy).toMatchObject({ public: true, reason: "REVEALED" });
    expect(await setCoursesPublicAsAdmin(db, { ...proof, reveal: false })).toMatchObject({ status: "saved",
      response: { courseSecrecy: { public: false, reason: null, revealedAt: null } } });
    expect(await forkingOf(proof.raceId)).toBeUndefined();
    const audits = (await pool.query<{ action: string }>("select action from audit_event where race_id = $1 and action like 'COURSES_%' order by created_at",
      [proof.raceId])).rows.map(row => row.action);
    expect(audits).toEqual(["COURSES_REVEALED_BY_ADMIN", "COURSES_REVEAL_WITHDRAWN_BY_ADMIN"]);

    // När alla kvar markerats ej start är ingen kvar: banorna är publika.
    const remaining = Object.entries(ids).filter(([name]) => name !== "Cia").map(([, id]) => id);
    expect(await markDidNotStart(proof, remaining)).toBe("saved");
    expect(await loadCourseSecrecy(db, proof.raceId)).toMatchObject({ public: true, reason: "ALL_FINISHED", remaining: 0 });
    expect((await forkingOf(proof.raceId))?.items).toHaveLength(5);
    const after = await publicResultDetail(db, proof.raceId, await publicIdOf(ids.Cia!));
    expect(after).toMatchObject({ status: "ok", response: { classCourse: { forking: { items: expect.any(Array) as unknown } } } });
  });

  it("räknar strukna som inte kvar och visar banorna när resultaten är fastställda även om någon tillkommit", async () => {
    const proof = await race();
    await importFile(proof, "course-data-forked.xml");
    await importFile(proof, "entry-list-forked.xml");
    await importFile(proof, "course-assignment-forked.xml");
    expect(await loadCourseSecrecy(db, proof.raceId)).toMatchObject({ public: false, remaining: 7 });
    await pool.query("update entry set struck_at = now() where race_id = $1 and given_name not in ('Ada', 'Cia')", [proof.raceId]);
    await readout(proof, "8101003", variantCodes("AD"));
    expect(await loadCourseSecrecy(db, proof.raceId)).toMatchObject({ public: false, remaining: 1 });
    await pool.query("update entry set struck_at = now() where race_id = $1 and given_name = 'Ada'", [proof.raceId]);
    expect(await loadCourseSecrecy(db, proof.raceId)).toMatchObject({ public: true, reason: "ALL_FINISHED" });
    const requestId = randomUUID();
    const official = await setResultsOfficialAsAdmin(db, { ...proof, idempotencyKey: `results-official:${requestId}`,
      request: { formatVersion: 1, requestId, action: "OFFICIAL" } });
    expect(official.status === "saved" && official.response.result.outcome).toBe("OFFICIAL");
    // En löpare som tillkommer efter fastställandet döljer inte banorna.
    await pool.query("update entry set struck_at = null where race_id = $1 and given_name = 'Bo'", [proof.raceId]);
    expect(await loadCourseSecrecy(db, proof.raceId)).toMatchObject({ public: true, reason: "FINALIZED", remaining: 1 });
  });
});
