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
import { listEntryTransfersAsAdmin } from "../../src/entry-transfer";
import { listCoursesForEditAsAdmin } from "../../src/course-edit";
import { changeEntryVariantAsAdmin } from "../../src/course-variant-assignment";
import { commitStartDrawAsAdmin } from "../../src/start-draw";
import { exportCurrentStartListXmlAsAdmin } from "../../src/start-list-publication";
import { readMapBundlesAsAdmin, recordMapPrintAsAdmin, saveMapReserveAsAdmin } from "../../src/map-bundles";
import { accountOnRace } from "./accounts";

/**
 * PLAN.md steg 61: gafflingar till start och karta. Tryckantal per variant med reserv och lediga tider, kartbuntslistan
 * och baksidorna ur samma plan, "N ändringar sedan listan skrevs ut", variantkoden i IOF StartList, kontrollen före
 * tävlingen och fel karta vid avläsningen med "Godkänn på BD" (befintliga variantbytet, auditpost med orsaken).
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Steg 61-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg61_${randomUUID().replaceAll("-", "")}`;
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
  if (!/^otid_steg61_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const loops = { A: [50, 41, 42], B: [50, 43, 44], C: [60, 61, 62], D: [60, 63, 64] } as const;
function variantCodes(code: "AC" | "AD" | "BC" | "BD"): number[] {
  const first = code[0] as "A" | "B", second = code[1] as "C" | "D";
  return [31, ...loops[first], ...loops[first === "A" ? "B" : "A"], 50, 32, ...loops[second], ...loops[second === "C" ? "D" : "C"], 60, 33];
}

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

async function race(): Promise<Proof> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `natt.${suffix}@test.o-tid.se`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Stockholm by Night", raceName: "Natt", raceDate: "2026-12-09", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

async function importFile(proof: Proof, name: string) {
  const result = await importIofXmlAsAdmin(db, { ...proof, idempotencyKey: `iof-import:${randomUUID()}`, xmlBytes: fixture(name) });
  if (result.status !== "stored") throw new Error(`Importen misslyckades: ${result.status}`);
}

async function ids(raceId: string): Promise<Record<string, string>> {
  const rows = (await pool.query<{ id: string; given_name: string }>("select id, given_name from entry where race_id = $1", [raceId])).rows;
  return Object.fromEntries(rows.map(row => [row.given_name, row.id]));
}

async function readout(proof: Proof, cardNumber: string, codes: readonly number[], start: string) {
  const startMs = Date.parse(start);
  const payload: SportidentReadoutPayload = {
    cardNumber, cardType: "SI10", startPunchedAt: new Date(startMs).toISOString(), finishPunchedAt: new Date(startMs + 3_600_000).toISOString(),
    punches: codes.map((code, index) => ({ code, punchedAt: new Date(startMs + 60_000 + index * 60_000).toISOString() })),
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true
  };
  const version = (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [proof.raceId])).rows[0]!.snapshot_version;
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: version, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: new Date(startMs + 3_660_000).toISOString(), transport: "sportident", payload,
      contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdmin(db, { ...proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
}

async function bundles(proof: Proof) {
  const result = await readMapBundlesAsAdmin(db, proof);
  if (result.status !== "ok") throw new Error(`Kartbuntarna saknas: ${result.status}`);
  return result.response;
}

describe("steg 61: gafflingar till start och karta", () => {
  it("tryckantal, kartbuntslista, utskrift med ändringar, IOF-varianten, kontrollen och fel karta", async () => {
    const proof = await race();
    await importFile(proof, "course-data-forked.xml");
    await importFile(proof, "entry-list-forked.xml");
    await importFile(proof, "course-assignment-forked.xml");
    const people = await ids(proof.raceId);

    // Kontrollen före tävlingen: Ada och Bo saknar variant i H21.
    const listed = await listCoursesForEditAsAdmin(db, proof);
    if (listed.status !== "ok") throw new Error("Banlistan saknas");
    expect(listed.response.courses.find(course => course.name === "Lång")?.readiness).toMatchObject({ ok: false,
      missingVariant: [{ className: "H21", count: 2 }], unusedVariants: [] });

    // Lottning med två lediga tider: löparna utan variant får en, och de lediga tiderna räknas i tryckantalet.
    const h21 = (await pool.query<{ id: string }>("select id from class where race_id = $1 and name = 'H21'", [proof.raceId])).rows[0]!.id;
    const requestId = randomUUID();
    const drawn = await commitStartDrawAsAdmin(db, { ...proof, idempotencyKey: `start-draw:${requestId}`, request: {
      formatVersion: 1, requestId, seed: 61, firstStartTime: "2026-12-09T17:00:00.000Z", clubSeparation: false, confirmChanges: false,
      classes: [{ classId: h21, method: "MINUTE", intervalMinutes: 1, vacancies: { kind: "COUNT", value: 2 } }] } });
    if (drawn.status !== "drawn") throw new Error(`Lottningen sparades inte: ${drawn.status}`);
    const afterDraw = await listCoursesForEditAsAdmin(db, proof);
    if (afterDraw.status !== "ok") throw new Error("Banlistan saknas");
    // Ingen saknar variant längre. Fördelningen är jämn per variant men kan vara ojämn per gafflingspunkt; kontrollen
    // räknar då per alternativ (sex löpare i H21).
    const readiness = afterDraw.response.courses.find(course => course.name === "Lång")?.readiness;
    expect(readiness).toMatchObject({ missingVariant: [], unusedVariants: [] });
    for (const point of readiness!.uneven) expect(point.counts.reduce((sum, row) => sum + row.count, 0)).toBe(6);
    expect(readiness!.ok).toBe(readiness!.uneven.length === 0);

    const reserve = await saveMapReserveAsAdmin(db, { ...proof, request: { formatVersion: 1, reserve: { kind: "COUNT", value: 1 } } });
    expect(reserve.status).toBe("saved");
    const plan = await bundles(proof);
    const lang = plan.groups.filter(group => group.courseName === "Lång");
    expect(lang.map(group => group.variantCode)).toEqual(["AC", "AD", "BC", "BD"]);
    // Sex löpare i H21 och två lediga tider fördelade på varianterna, plus en reserv per variant.
    expect(lang.reduce((sum, group) => sum + group.runnerCount, 0)).toBe(6);
    expect(lang.reduce((sum, group) => sum + group.vacancyCount, 0)).toBe(2);
    expect(lang.every(group => group.reserveCount === 1 && group.printCount === group.runnerCount + group.vacancyCount + 1)).toBe(true);
    // Kartbuntslistan i startordning med startnummer; varje rad har variantkod i H21.
    const h21Rows = plan.rows.filter(row => row.className === "H21");
    expect(h21Rows).toHaveLength(8);
    expect(h21Rows.every(row => row.variantCode !== null && row.startMode === "MINUTE")).toBe(true);
    expect(plan.rows.map(row => row.number)).toEqual(plan.rows.map((_row, index) => index + 1));
    expect(plan.prints).toEqual({});

    // Variantkoden i IOF StartList ("Lång-AD" som bana för Cia).
    const startList = await exportCurrentStartListXmlAsAdmin(db, proof);
    if (startList.status !== "exported") throw new Error(`Startlistan exporterades inte: ${startList.status}`);
    expect(startList.xml).toMatch(/<Given>Cia<\/Given>[\s\S]*?<Course>\s*<Name>Lång-AD<\/Name>\s*<\/Course>/);

    // Utskrift: läget sparas mot det som visades; en gammal lista ger konflikt.
    expect((await recordMapPrintAsAdmin(db, { ...proof, request: { formatVersion: 1, list: "BUNDLE", stateHash: "0".repeat(64) } })).status)
      .toBe("conflict");
    const printed = await recordMapPrintAsAdmin(db, { ...proof, request: { formatVersion: 1, list: "BUNDLE", stateHash: plan.stateHash } });
    if (printed.status !== "printed") throw new Error(`Utskriften sparades inte: ${printed.status}`);
    expect((await recordMapPrintAsAdmin(db, { ...proof, request: { formatVersion: 1, list: "BACKS", stateHash: plan.stateHash } })).status).toBe("printed");
    expect((await bundles(proof)).prints).toMatchObject({ BUNDLE: { printedAt: printed.response.printedAt, changes: [] }, BACKS: { changes: [] } });

    // Cia byter variant efter utskriften: syns i kartbuntslistan och i baksidornas tryckantal.
    const cia = (await pool.query<{ version: number }>("select version from entry where id = $1", [people.Cia])).rows[0]!;
    const changeId = randomUUID();
    const changed = await changeEntryVariantAsAdmin(db, { ...proof, idempotencyKey: `entry-variant:${changeId}`, request: { formatVersion: 1,
      requestId: changeId, expectedEntryVersion: cia.version, entryId: people.Cia, variantCode: "BD", confirmResultChanges: false } });
    expect(changed.status).toBe("changed");
    const later = await bundles(proof);
    expect(later.prints.BUNDLE?.changes).toEqual([{ kind: "VARIANT", name: "Cia Holm", className: "H21", from: "AD", to: "BD" }]);
    expect(later.prints.BACKS?.changes).toEqual(expect.arrayContaining([
      { kind: "VARIANT", name: "Cia Holm", className: "H21", from: "AD", to: "BD" },
      expect.objectContaining({ kind: "COUNT", courseName: "Lång", variantCode: "BD" })]));

    // Fel karta: Eva har AC men stämplar BD. Felstämplad, med beskedet; inget byts.
    const eva = (await pool.query<{ fixed_start_time: Date; course_variant_code: string; version: number }>(
      "select fixed_start_time, course_variant_code, version from entry where id = $1", [people.Eva])).rows[0]!;
    const assigned = eva.course_variant_code as "AC" | "AD" | "BC" | "BD";
    const other = (["AC", "AD", "BC", "BD"] as const).find(code => code !== assigned)!;
    await readout(proof, "8101005", variantCodes(other), eva.fixed_start_time.toISOString());
    const result = await getAdministratorEffectiveResult(db, { ...proof, entryId: people.Eva! });
    if (result.status !== "ok" || result.response.state !== "ACTIVE_RESULT") throw new Error("Resultatet saknas");
    expect(result.response.result.status).toBe("MP");
    expect(result.response.notes?.wrongMap).toEqual({ assignedCode: assigned, fittingCodes: [other] });
    const roster = await listEntryTransfersAsAdmin(db, proof);
    if (roster.status !== "ok") throw new Error("Deltagarlistan saknas");
    expect(roster.response.entries.find(entry => entry.id === people.Eva)?.notes?.wrongMap).toEqual({ assignedCode: assigned, fittingCodes: [other] });
    expect((await pool.query<{ course_variant_code: string }>("select course_variant_code from entry where id = $1", [people.Eva])).rows[0]!.course_variant_code)
      .toBe(assigned);

    // "Godkänn på …": befintliga variantbytet med ny revision och orsaken i auditposten.
    const approveId = randomUUID();
    const approved = await changeEntryVariantAsAdmin(db, { ...proof, idempotencyKey: `entry-variant:${approveId}`, request: { formatVersion: 1,
      requestId: approveId, expectedEntryVersion: eva.version, entryId: people.Eva, variantCode: other, confirmResultChanges: true, reason: "WRONG_MAP" } });
    if (approved.status !== "changed") throw new Error(`Bytet sparades inte: ${approved.status}`);
    const afterApprove = await getAdministratorEffectiveResult(db, { ...proof, entryId: people.Eva! });
    if (afterApprove.status !== "ok" || afterApprove.response.state !== "ACTIVE_RESULT") throw new Error("Resultatet saknas");
    expect(afterApprove.response.result.status).toBe("OK");
    expect(afterApprove.response.notes?.wrongMap).toBeUndefined();
    const audit = (await pool.query<{ after: Record<string, unknown> }>(
      "select after from audit_event where request_id = $1 and action = 'ENTRY_COURSE_VARIANT_CHANGED_BY_ADMIN'", [approveId])).rows[0]!;
    expect(audit.after).toMatchObject({ courseVariantCode: other, reason: "Fel karta vid starten" });
    expect((await pool.query<{ status: string }>("select status from result_revision where entry_id = $1 order by revision", [people.Eva]))
      .rows.map(row => row.status)).toEqual(["MP", "OK"]);
  });
});
