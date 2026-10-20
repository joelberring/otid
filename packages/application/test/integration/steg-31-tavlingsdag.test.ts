import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { applyRaceCorrectionAsAdmin, listRaceCorrectionsAsAdmin, previewRaceCorrectionAsAdmin } from "../../src/race-corrections";
import { loadRaceSnapshot } from "../../src/snapshot";
import { getAdministratorEffectiveResult } from "../../src/administrator-effective-result";
import { auth, ingest, NOW, RACE_DATE, run, seedRace } from "./steg-25-fixtures";

/** PLAN.md steg 31 (del A): rättningar för hela tävlingen. */
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för vald isolerad testdatabas");
const { db, pool } = createDatabase(url);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

type Admin = Awaited<ReturnType<typeof seedRace>>["admin"];
type Correction = Parameters<typeof previewRaceCorrectionAsAdmin>[1]["request"];

async function latest(raceId: string, entryId: string) {
  const { rows } = await pool.query<{ revision: number; cause: string; status: string; reason: string; evaluation: { elapsedMs?: number;
    splits: { controlCode: number; legMs: number }[] } }>(
    "SELECT revision, cause, status, reason, evaluation FROM result_revision WHERE race_id = $1 AND entry_id = $2 ORDER BY revision DESC LIMIT 1",
    [raceId, entryId]);
  return rows[0]!;
}

async function raw(raceId: string) {
  const readouts = (await pool.query("SELECT * FROM card_readout WHERE race_id = $1 ORDER BY id", [raceId])).rows;
  const messages = (await pool.query("SELECT * FROM raw_device_message WHERE race_id = $1 ORDER BY id", [raceId])).rows;
  return JSON.stringify({ readouts, messages });
}

/** Visa vad som händer och spara med beskedets hash. */
async function previewAndApply(admin: Admin, correction: Correction) {
  const preview = await previewRaceCorrectionAsAdmin(db, { ...admin, request: { formatVersion: 1, correction } }, NOW);
  if (preview.status !== "ok") throw new Error(`Förhandsvisningen misslyckades: ${preview.status}`);
  const requestId = randomUUID();
  const applied = await applyRaceCorrectionAsAdmin(db, { ...admin, request: { formatVersion: 1, requestId,
    expectedPreviewHash: preview.response.previewHash, correction } }, NOW);
  if (applied.status !== "applied") throw new Error(`Sparandet misslyckades: ${applied.status}`);
  return { preview: preview.response, applied: applied.response, requestId };
}

describe("steg 31: tidsjustering för en station", () => {
  it("justerar målets klocka för alla, räknar om, visar förhandsbesked och går att ta bort", async () => {
    const { ids, cards, admin } = await seedRace(db, pool);
    // Målklockan går en timme fel: Ada (lottad 10:02) springer 30 min men får mål 11:32.
    const ada = run(cards.ada, "10:02:00", 30);
    const cia = run(cards.cia, "10:10:00", 40);
    const late = (payload: ReturnType<typeof run>) => ({ ...payload,
      finishPunchedAt: new Date(Date.parse(payload.finishPunchedAt) + 3_600_000).toISOString() });
    await ingest(db, ids.race, [late(ada), late(cia)]);
    expect((await latest(ids.race, ids.ada)).evaluation.elapsedMs).toBe(90 * 60_000);
    const original = await raw(ids.race);
    const correction = { action: "ADD_TIME_ADJUSTMENT" as const, station: "FINISH" as const, offsetSeconds: -3600, reason: "Målklockan fel" };

    const functionary = await auth(db, ids.race, "FUNCTIONARY");
    expect((await previewRaceCorrectionAsAdmin(db, { ...functionary, request: { formatVersion: 1, correction } }, NOW)).status).toBe("forbidden");

    const { preview, applied, requestId } = await previewAndApply(admin, correction);
    expect(preview.summary).toMatchObject({ readOutCount: 2, affectedCount: 2, notRecalculatedCount: 0, changes: [] });
    expect(applied).toMatchObject({ replayed: false, recalculatedCount: 2 });
    expect(await latest(ids.race, ids.ada)).toMatchObject({ cause: "EXPLICIT_RECALCULATION", status: "OK" });
    expect((await latest(ids.race, ids.ada)).evaluation.elapsedMs).toBe(30 * 60_000);
    expect((await latest(ids.race, ids.cia)).evaluation.elapsedMs).toBe(40 * 60_000);
    expect(await raw(ids.race)).toBe(original);
    // Deltagarkortet: resultatet och notisen om justerad tid.
    const card = await getAdministratorEffectiveResult(db, { ...admin, entryId: ids.ada }, NOW);
    expect(card).toMatchObject({ status: "ok", response: { result: { status: "OK" },
      cardPunches: { adjustments: [{ station: "FINISH", offsetMs: -3_600_000, punches: 1 }] } } });

    // Samma begäran igen ändrar inget; en gammal förhandsvisning sparas inte.
    const again = await applyRaceCorrectionAsAdmin(db, { ...admin, request: { formatVersion: 1, requestId,
      expectedPreviewHash: preview.previewHash, correction } }, NOW);
    expect(again).toMatchObject({ status: "applied", response: { replayed: true } });
    expect((await applyRaceCorrectionAsAdmin(db, { ...admin, request: { formatVersion: 1, requestId: randomUUID(),
      expectedPreviewHash: preview.previewHash, correction } }, NOW)).status).toBe("conflict");

    // Paketet till avläsningen har justeringen, så att nästa avläsning bedöms likadant lokalt.
    expect((await loadRaceSnapshot(db, ids.race)).stationTimeAdjustments).toMatchObject([{ station: "FINISH", offsetMs: -3_600_000 }]);
    const listed = await listRaceCorrectionsAsAdmin(db, admin, NOW);
    if (listed.status !== "ok") throw new Error("Listan saknas");
    const [row] = listed.response.corrections;
    expect(row).toMatchObject({ kind: "TIME_ADJUSTMENT", station: "FINISH", offsetMs: -3_600_000, reason: "Målklockan fel", removedAt: null });

    // Ta bort: räknar om tillbaka; raden står kvar som historik.
    const removed = await previewAndApply(admin, { action: "REMOVE", correctionId: row!.id });
    expect(removed.applied.recalculatedCount).toBe(2);
    expect((await latest(ids.race, ids.ada)).evaluation.elapsedMs).toBe(90 * 60_000);
    const after = await listRaceCorrectionsAsAdmin(db, admin, NOW);
    expect(after.status === "ok" && after.response.corrections[0]?.removedAt).toBeTruthy();
    await expect(pool.query("UPDATE race_station_correction SET reason = 'x' WHERE id = $1", [row!.id])).rejects.toThrow();
    await expect(pool.query("DELETE FROM race_station_correction WHERE id = $1", [row!.id])).rejects.toThrow();
    const audit = await pool.query("SELECT action FROM audit_event WHERE race_id = $1 AND action = 'RACE_CORRECTION_APPLIED_BY_ADMIN'", [ids.race]);
    expect(audit.rowCount).toBe(2);
    expect(RACE_DATE).toBe("2026-09-19");
  });

  it("en kontroll med fel klocka får rätta sträcktider; en station har högst en justering", async () => {
    const { ids, cards, admin } = await seedRace(db, pool);
    const ada = run(cards.ada, "10:02:00", 30);
    // Kontroll 31 en timme efter: ingen sträcktid för 31 före justeringen.
    await ingest(db, ids.race, [{ ...ada, punches: [{ code: 31, punchedAt: "2026-09-19T11:12:00.000Z" }, ada.punches[1]!] }]);
    expect((await latest(ids.race, ids.ada)).evaluation.splits.map(split => split.controlCode)).toEqual([32]);
    await previewAndApply(admin, { action: "ADD_TIME_ADJUSTMENT", station: "CONTROL", controlCode: 31, offsetSeconds: -3600, reason: "Fel klocka" });
    expect((await latest(ids.race, ids.ada)).evaluation.splits.map(split => split.legMs)).toEqual([10, 10].map(m => m * 60_000));
    // En andra justering för samma station avvisas (ta bort den första först).
    expect((await previewRaceCorrectionAsAdmin(db, { ...admin, request: { formatVersion: 1, correction: { action: "ADD_TIME_ADJUSTMENT",
      station: "CONTROL", controlCode: 31, offsetSeconds: 60, reason: "Igen" } } }, NOW)).status).toBe("conflict");
  });
});

describe("steg 31: kontroll ur funktion", () => {
  it("krävs inte för någon, visas som ur funktion i sträcktiderna och kan tas bort", async () => {
    const { ids, cards, admin } = await seedRace(db, pool);
    const ada = run(cards.ada, "10:02:00", 30);
    await ingest(db, ids.race, [{ ...ada, punches: [ada.punches[1]!] }, run(cards.bo, "10:05:00", 41)]);
    expect(await latest(ids.race, ids.ada)).toMatchObject({ status: "MP", reason: "MISSING_CONTROL" });
    // En kod som inte finns i tävlingen avvisas.
    expect((await previewRaceCorrectionAsAdmin(db, { ...admin, request: { formatVersion: 1, correction: { action: "ADD_CONTROL_OUT_OF_ORDER",
      controlCode: 99, reason: "Fel" } } }, NOW)).status).toBe("not-found");
    const { preview, applied } = await previewAndApply(admin, { action: "ADD_CONTROL_OUT_OF_ORDER", controlCode: 31, reason: "Enheten saknades" });
    expect(preview.summary.changes).toMatchObject([{ entryId: ids.ada, before: "MP", after: "OK" }]);
    expect(applied.recalculatedCount).toBe(2);
    expect(await latest(ids.race, ids.ada)).toMatchObject({ status: "OK" });
    // Bo stämplade 31: ingen sträcktid där, sträckan till 32 räknas från starten.
    expect((await latest(ids.race, ids.bo)).evaluation.splits.map(split => split.controlCode)).toEqual([32]);
    const card = await getAdministratorEffectiveResult(db, { ...admin, entryId: ids.bo }, NOW);
    expect(card.status === "ok" && card.response.state === "ACTIVE_RESULT" && card.response.controlDetails?.controls)
      .toMatchObject([{ controlCode: 31, elapsedMs: null, outOfOrder: true }, { controlCode: 32 }]);
    expect((await loadRaceSnapshot(db, ids.race)).controlsOutOfOrder).toMatchObject([{ controlCode: 31 }]);

    const listed = await listRaceCorrectionsAsAdmin(db, admin, NOW);
    const row = listed.status === "ok" ? listed.response.corrections.find(value => value.kind === "CONTROL_OUT_OF_ORDER") : undefined;
    await previewAndApply(admin, { action: "REMOVE", correctionId: row!.id });
    expect(await latest(ids.race, ids.ada)).toMatchObject({ status: "MP", reason: "MISSING_CONTROL" });
    expect((await latest(ids.race, ids.bo)).evaluation.splits.map(split => split.controlCode)).toEqual([31, 32]);
  });
});

describe("steg 31: flytta starttider för en klass", () => {
  it("flyttar alla tilldelade tider i klassen, räknar om de avlästa och går att flytta tillbaka", async () => {
    const { ids, cards, admin } = await seedRace(db, pool);
    // Startklockan var fel: Ada (lottad 10:02) startade i själva verket 10:07 och sprang 30 min.
    await ingest(db, ids.race, [run(cards.ada, "10:07:00", 30)]);
    expect((await latest(ids.race, ids.ada)).evaluation.elapsedMs).toBe(35 * 60_000);
    const correction = { action: "SHIFT_START_TIMES" as const, classId: ids.fixed, offsetSeconds: 300, reason: "Starten kom igång sent" };
    const { preview, applied } = await previewAndApply(admin, correction);
    // Bo har ingen tilldelad tid och flyttas inte.
    expect(preview.summary.startTimes).toEqual({ count: 1, firstBefore: `${RACE_DATE}T10:02:00.000Z`, firstAfter: `${RACE_DATE}T10:07:00.000Z`,
      lastBefore: `${RACE_DATE}T10:02:00.000Z`, lastAfter: `${RACE_DATE}T10:07:00.000Z` });
    expect(applied.recalculatedCount).toBe(1);
    expect((await latest(ids.race, ids.ada)).evaluation.elapsedMs).toBe(30 * 60_000);
    const entry = await pool.query<{ time: Date; version: number }>("SELECT fixed_start_time AS time, version FROM entry WHERE id = $1", [ids.ada]);
    expect(entry.rows[0]!.time.toISOString()).toBe(`${RACE_DATE}T10:07:00.000Z`);
    // Fri start kan inte flyttas.
    expect((await previewRaceCorrectionAsAdmin(db, { ...admin, request: { formatVersion: 1, correction: { ...correction, classId: ids.free } } }, NOW))
      .status).toBe("conflict");
    await previewAndApply(admin, { ...correction, offsetSeconds: -300 });
    expect((await latest(ids.race, ids.ada)).evaluation.elapsedMs).toBe(35 * 60_000);
  });
});
