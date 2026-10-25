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
import { getAdministratorEffectiveResult } from "../../src/administrator-effective-result";
import { listCoursesForEditAsAdmin, previewCourseEditAsAdmin, editCourseAsAdmin } from "../../src/course-edit";
import { saveCourseDetailsAsAdmin } from "../../src/course-details";
import { publicResultDetail } from "../../src/results";
import { publicResults } from "../../src/results";
import { accountOnRace } from "./accounts";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Steg 49-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg49_fork_${randomUUID().replaceAll("-", "")}`;
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
  if (!/^otid_steg49_fork_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
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
  const account = await registerUserAccount(db, { formatVersion: 1, email: `gaffel.${suffix}@test.o-tid.se`, displayName: "Arrangör", password: "hemligt-lösen" });
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

async function variants(raceId: string): Promise<Record<string, string | null>> {
  const rows = (await pool.query<{ given_name: string; course_variant_code: string | null }>(
    "select given_name, course_variant_code from entry where race_id = $1", [raceId])).rows;
  return Object.fromEntries(rows.map(row => [row.given_name, row.course_variant_code]));
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

async function effective(proof: Proof, entryId: string) {
  const result = await getAdministratorEffectiveResult(db, { ...proof, entryId });
  if (result.status !== "ok" || result.response.state !== "ACTIVE_RESULT") throw new Error("Gällande resultat saknas");
  return { status: result.response.result.status, current: result.response.resultCurrent };
}

const revisions = async (entryId: string) => (await pool.query<{ status: string; cause: string }>(
  "select status, cause from result_revision where entry_id = $1 order by revision", [entryId])).rows;


// Strukturen som banfilens varianter ger (steg 49): två fjärilar.
const butterfly = (center: number, loops: number[][]) => ({ kind: "LOOP" as const, center, loops });
const control = (code: number) => ({ kind: "CONTROL" as const, code });

describe("steg 49: gafflingsstruktur", () => {
  it("härleder strukturen ur banfilen, sparar en struktur med omräkning och ger löparna rätt variant", async () => {
    const proof = await race();
    await importFile(proof, "course-data-forked.xml");
    await importFile(proof, "entry-list-forked.xml");
    await importFile(proof, "course-assignment-forked.xml");
    const ids = await entryIds(proof.raceId);
    await readout(proof, "8101003", variantCodes("AD"));
    expect(await effective(proof, ids.Cia!)).toMatchObject({ status: "OK" });

    // Banlistan: härledd struktur (två fjärilar), varje variants val, längderna ur banfilen och utjämnad bana utan varning.
    const listed = await listCoursesForEditAsAdmin(db, proof);
    if (listed.status !== "ok") throw new Error("Banlistan saknas");
    const lang = listed.response.courses.find(course => course.name === "Lång")!;
    const courseId = lang.courseId;
    expect(lang.forking).toMatchObject({ stored: false, convertible: true, addedCount: 0,
      items: [control(31), butterfly(50, [[41, 42], [43, 44]]), control(32), butterfly(60, [[61, 62], [63, 64]]), control(33)] });
    expect(lang.forking!.variants.find(variant => variant.code === "BD")).toEqual({ code: "BD", choices: [null, [1, 0], null, [1, 0], null], lengthMeters: 6200 });
    expect(lang.forkingMode).toBe("BALANCED");
    expect(lang.fairness).toMatchObject({ level: "NONE", shortestMeters: 6200, longestMeters: 6200 });
    expect(lang.variants.map(variant => variant.lengthMeters)).toEqual([6200, 6200, 6200, 6200]);

    // Fjärilen med slingorna i omvänd ordning: samma kontrollföljder under nya koder. Löparna behåller sin kontrollföljd.
    const swapped = { items: [control(31), butterfly(50, [[43, 44], [41, 42]]), control(32), butterfly(60, [[61, 62], [63, 64]]), control(33)] };
    const preview = await previewCourseEditAsAdmin(db, { ...proof, courseId, request: { formatVersion: 1, forking: swapped } });
    expect(preview).toMatchObject({ status: "ok", response: { controlCodes: [], readOutCount: 1, unchangedCount: 1, requiresConfirmation: false,
      forking: { removedCodes: [], renamedEntryCount: 4, reassignedEntryCount: 0 } } });
    if (preview.status !== "ok") throw new Error("Beskedet saknas");
    expect(preview.response.forking!.variants.map(variant => `${variant.previousCode}>${variant.code}`)).toEqual(["BC>AC", "BD>AD", "AC>BC", "AD>BD"]);
    const firstId = randomUUID();
    const first = await editCourseAsAdmin(db, { ...proof, idempotencyKey: `course-edit:${firstId}`, request: { formatVersion: 1,
      requestId: firstId, courseId, forking: swapped, confirmResultChanges: false } });
    expect(first.status).toBe("edited");
    expect(await variants(proof.raceId)).toEqual({ Ada: null, Bo: null, Cia: "BD", Dan: "AC", Eva: "BC", Fia: "AD", Gun: null });
    expect((await revisions(ids.Cia!)).map(row => row.cause)).toEqual(["CARD_READOUT", "EXPLICIT_RECALCULATION"]);
    expect(await effective(proof, ids.Cia!)).toMatchObject({ status: "OK", current: true });
    // Samma struktur igen är ingen ändring.
    expect((await previewCourseEditAsAdmin(db, { ...proof, courseId, request: { formatVersion: 1, forking: swapped } })).status).toBe("invalid-request");

    // Den andra fjärilen blir en enkel gaffling: alla kontrollföljder försvinner och löparna får nya varianter genom
    // fördelningen. Cias stämplingar passar en av de nya varianterna, så hennes resultat ändras inte.
    const forked = { items: [control(31), butterfly(50, [[43, 44], [41, 42]]), control(32), control(60),
      { kind: "FORK" as const, branches: [[61, 62], [63, 64]] }, control(60), control(33)] };
    const second = await previewCourseEditAsAdmin(db, { ...proof, courseId, request: { formatVersion: 1, forking: forked } });
    expect(second).toMatchObject({ status: "ok", response: { requiresConfirmation: false, unchangedCount: 1,
      forking: { removedCodes: ["AC", "AD", "BC", "BD"], renamedEntryCount: 0, reassignedEntryCount: 4 } } });
    const secondId = randomUUID();
    expect((await editCourseAsAdmin(db, { ...proof, idempotencyKey: `course-edit:${secondId}`, request: { formatVersion: 1,
      requestId: secondId, courseId, forking: forked, confirmResultChanges: false } })).status).toBe("edited");
    const after = await variants(proof.raceId);
    // Cias stämplingar (63 64 60 61 62 60) passar båda alternativen efter 60; den första som passar väljs.
    expect(after.Cia).toBe("BC");
    expect(["AC", "AD", "BC", "BD"]).toEqual(expect.arrayContaining([after.Dan, after.Eva, after.Fia]));
    expect([after.Ada, after.Bo, after.Gun]).toEqual([null, null, null]);
    expect(await effective(proof, ids.Cia!)).toMatchObject({ status: "OK", current: true });
    const audit = (await pool.query<{ after: { removedCodes: string[]; reassignedEntryCount: number } }>(
      "select after from audit_event where entity_id = $1 and action = 'COURSE_EDITED_BY_ADMIN' order by created_at desc limit 1", [courseId])).rows[0]!;
    expect(audit.after).toMatchObject({ removedCodes: ["AC", "AD", "BC", "BD"], reassignedEntryCount: 4 });

    // Sparad struktur i listan; en enkel gaffling varnar i en utjämnad bana och är bara en upplysning i en fulgaffling.
    const relisted = await listCoursesForEditAsAdmin(db, proof);
    if (relisted.status !== "ok") throw new Error("Banlistan saknas");
    const saved = relisted.response.courses.find(course => course.courseId === courseId)!;
    expect(saved.forking).toMatchObject({ stored: true, items: forked.items });
    expect(saved.fairness?.level).toBe("WARNING");
    expect(saved.variants.map(variant => variant.lengthMeters)).toEqual([null, null, null, null]);
    const modeId = randomUUID();
    expect((await saveCourseDetailsAsAdmin(db, { ...proof, idempotencyKey: `course-details:${modeId}`, request: { formatVersion: 1,
      requestId: modeId, courseId, lengthMeters: 6200, climbMeters: 85, forkingMode: "UNEQUAL" } })).status).toBe("saved");
    const unequal = await listCoursesForEditAsAdmin(db, proof);
    if (unequal.status !== "ok") throw new Error("Banlistan saknas");
    expect(unequal.response.courses.find(course => course.courseId === courseId)).toMatchObject({ forkingMode: "UNEQUAL", fairness: { level: "NOTICE" } });

    // En ogiltig struktur (ett alternativ utan kontroller) sparas inte.
    const invalidId = randomUUID();
    expect((await editCourseAsAdmin(db, { ...proof, idempotencyKey: `course-edit:${invalidId}`, request: { formatVersion: 1, requestId: invalidId,
      courseId, forking: { items: [control(31), { kind: "FORK", branches: [[41], []] }] }, confirmResultChanges: false } })).status).toBe("invalid-request");

    // Publikt: klassens bana med strukturen och varje variants val.
    const published = await publicResults(db, proof.raceId);
    const h21 = "classCourses" in published ? published.classCourses?.find(row => row.className === "H21") : undefined;
    expect(h21?.forking?.items).toEqual(forked.items);
    expect(h21?.forking?.variants.find(variant => variant.code === "AD")?.choices).toEqual([null, [0, 1], null, null, 1, null, null]);
    const cia = published.results.find(row => "publicResultId" in row && row.givenName === "Cia");
    if (!cia || !("publicResultId" in cia)) throw new Error("Cia saknas publikt");
    const detail = await publicResultDetail(db, proof.raceId, cia.publicResultId);
    expect(detail).toMatchObject({ status: "ok", response: { classCourse: { className: "H21", forking: { items: forked.items } } } });
  });
});
