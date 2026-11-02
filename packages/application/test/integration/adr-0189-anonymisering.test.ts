import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { contentHash } from "../../src/serialization";
import { ingestDeviceBatch } from "../../src/ingest";
import { publicResults } from "../../src/results";
import { removeEntryAsAdmin } from "../../src/race-removal";
import { createEvent } from "../../src/events";
import { retentionCutoff, runRetention } from "../../src/retention";
import { db, importedRace, pool, useRaceDatabase } from "./race-fixtures";
import { raceAuth } from "./accounts";
import { setEntryStatus } from "../../src/entry-status";
import { setResultsOfficialAsAdmin } from "../../src/result-official";
import { exportFrozenIofResultListAsAdmin } from "../../src/result-finalization";
import { ingest, NOW as RACE_NOW, run, seedRace } from "./steg-25-fixtures";

/**
 * ADR-0189 beslut 5–6: en arrangör anonymiserar en deltagare; resultatet och sträcktiderna står kvar som "Anonym deltagare",
 * och namnet, klubben, brickan och Eventors id finns inte kvar i tävlingens tabeller (journalerna, de inlästa filerna) utom i
 * avläsningarnas brickkolumner. Gallringen anonymiserar eller tar bort gamla tävlingar. Testdata är påhittade (fixtures/iof).
 */
useRaceDatabase();

const NOW = new Date("2026-08-30T14:00:00Z");

/** Allt i tävlingens tabeller som text, utom brickans identitet i avläsningarna (som aldrig ändras). */
async function raceText(raceId: string): Promise<Map<string, string>> {
  const tables = (await pool.query<{ table_name: string }>(`select table_name from information_schema.columns where table_schema = current_schema()
    and column_name = 'race_id' and table_name not in ('card_assignment', 'card_readout', 'raw_device_message', 'radio_punch',
    'unknown_readout_resolution', 'device_ingest_outcome', 'entry_card_change_request', 'entry_card_rental_change', 'entry_card_rental_return_change',
    'entry_card_rental_reuse_request', 'entry_registration_request')`)).rows.map(row => row.table_name);
  const text = new Map<string, string>();
  for (const table of tables) {
    const rows = (await pool.query<{ row: string }>(`select to_jsonb(t)::text as row from "${table}" t where race_id = $1`, [raceId])).rows;
    if (rows.length > 0) text.set(table, rows.map(row => row.row).join("\n"));
  }
  return text;
}

const found = (text: Map<string, string>, needle: string) => [...text].filter(([, value]) => value.includes(needle)).map(([table]) => table);

describe("ADR-0189: anonymisera en deltagare", () => {
  it("tar bort namn, klubb, bricka och id ur tävlingen men behåller resultatet och sträcktiderna", async () => {
    const { raceId } = await importedRace();
    const entries = await db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId));
    const ada = entries.find(entry => entry.givenName === "Ada")!, bo = entries.find(entry => entry.givenName === "Bo")!;
    // En journalpost om Ada och en lista med båda (som den publicerade startlistan).
    await db.insert(schema.auditEvents).values([
      { raceId, entityType: "entry", entityId: ada.id, action: "TEST_IDENTITY", createdAt: NOW,
        before: { identity: { givenName: "Adam", familyName: "Löpare", organisationName: "Centrum OK" }, cardNumber: "12345" },
        after: { note: "Ada Löpare bytte namn", birthYear: 1990 } },
      { raceId, entityType: "race", entityId: raceId, action: "TEST_LIST", createdAt: NOW, after: { entries: [
        { entryId: ada.id, givenName: "Ada", familyName: "Löpare", organisationName: "Centrum OK", cardNumber: "12345", start: "10:00" },
        { entryId: bo.id, givenName: "Bo", familyName: "Skog", organisationName: "Centrum OK", cardNumber: "67890", start: "10:02" }] } }]);
    // Ada springer: 31, 32, 33 och mål.
    const at = (minutes: number) => new Date(Date.parse("2026-08-30T10:00:00Z") + minutes * 60_000).toISOString();
    const payload = { cardNumber: "12345", startPunchedAt: at(0), finishPunchedAt: at(30),
      punches: [{ code: 31, punchedAt: at(8) }, { code: 32, punchedAt: at(17) }, { code: 33, punchedAt: at(25) }] };
    const deviceId = randomUUID();
    await ingestDeviceBatch(db, raceId, { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 1, lastSequence: 1,
      events: [{ localSequence: 1, stationReceivedAt: at(31), transport: "simulator", payload, contentHash: contentHash(payload) }] });
    const resultOf = async (entryId: string) => ((await publicResults(db, raceId)).results as readonly Record<string, unknown>[])
      .find(row => row.publicResultId === entries.find(entry => entry.id === entryId)!.publicResultId) as { givenName: string; elapsedMs: number; splits: unknown; status: string } | undefined;
    const before = await resultOf(ada.id);
    expect(before).toMatchObject({ givenName: "Ada", familyName: "Löpare", elapsedMs: 30 * 60_000 });
    expect((await raceText(raceId)).get("import_file")).toContain("Löpare");

    const admin = await raceAuth(db, raceId, "ADMIN", NOW);
    const requestId = randomUUID();
    const request = { formatVersion: 1, requestId, entryId: ada.id, mode: "ANONYMIZE", expectedEntryVersion: ada.version };
    const saved = await removeEntryAsAdmin(db, { ...admin, idempotencyKey: `entry-removal:${requestId}`, request }, NOW);
    expect(saved).toMatchObject({ status: "saved", response: { result: { outcome: "ANONYMIZED" }, replayed: false } });

    const after = await resultOf(ada.id);
    expect(after).toMatchObject({ givenName: "Anonym", familyName: "deltagare", organisationName: null, elapsedMs: before!.elapsedMs,
      splits: before!.splits, status: before!.status });
    const [row] = await db.select().from(schema.entries).where(eq(schema.entries.id, ada.id));
    expect(row).toMatchObject({ givenName: "Anonym", familyName: "deltagare", organisationName: null, externalId: null, eventorPersonId: null });
    expect(row!.anonymizedAt).not.toBeNull();

    // Inget om Ada kvar i tävlingens tabeller (journalen, den inlästa IOF-filen, listan); Bo är orörd.
    const text = await raceText(raceId);
    expect(found(text, "Löpare")).toEqual([]);
    expect(found(text, "Adam")).toEqual([]);
    expect(found(text, "person-ada")).toEqual([]);
    expect(found(text, "12345")).toEqual([]);
    expect(found(text, "1990")).toEqual([]);
    expect(found(text, "Skog")).toEqual(expect.arrayContaining(["entry", "import_file", "audit_event"]));
    expect(found(text, "67890")).toEqual(expect.arrayContaining(["import_file", "audit_event"]));
    const list = (await pool.query<{ after: { entries: Record<string, unknown>[] } }>(
      "select after from audit_event where race_id = $1 and action = 'TEST_LIST'", [raceId])).rows[0]!.after.entries;
    expect(list[0]).toEqual({ entryId: ada.id, givenName: "Anonym", familyName: "deltagare", organisationName: null, start: "10:00" });
    expect(list[1]).toMatchObject({ givenName: "Bo", familyName: "Skog", cardNumber: "67890" });
    // Journalposten för anonymiseringen har inga namn.
    const [journal] = (await pool.query("select before, after from audit_event where race_id = $1 and action = 'ENTRY_ANONYMIZED_BY_ADMIN'",
      [raceId])).rows as { before: unknown; after: unknown }[];
    expect(JSON.stringify(journal)).not.toMatch(/Ada|Löpare/);

    // Samma begäran igen ger samma kvitto.
    expect(await removeEntryAsAdmin(db, { ...admin, idempotencyKey: `entry-removal:${requestId}`, request }, NOW))
      .toMatchObject({ status: "saved", response: { replayed: true, result: { outcome: "ANONYMIZED" } } });
  });
});

describe("ADR-0189: anonymisering efter fastställandet", () => {
  it("listan förblir officiell och den fastställda IOF-filen har Anonym deltagare i stället för namnet", async () => {
    const { ids, cards, admin } = await seedRace(db, pool);
    await ingest(db, ids.race, [run(cards.ada, "10:02:00", 40), run(cards.cia, "11:00:00", 30), run(cards.dan, "11:05:00", 33)]);
    for (const entryId of [ids.bo, ids.eva]) {
      const requestId = randomUUID();
      expect((await setEntryStatus(db, { ...admin, entryId, idempotencyKey: `entry-status:${requestId}`,
        request: { formatVersion: 1, requestId, expectedRevision: 0, decision: { kind: "DID_NOT_START" } } }, RACE_NOW)).status).toBe("decided");
    }
    const officialRequest = randomUUID();
    const official = await setResultsOfficialAsAdmin(db, { ...admin, idempotencyKey: `results-official:${officialRequest}`,
      request: { formatVersion: 1, requestId: officialRequest, action: "OFFICIAL" } }, new Date(RACE_NOW.getTime() + 60_000));
    if (official.status !== "saved" || official.response.result.outcome !== "OFFICIAL") throw new Error("Inte fastställd");
    const finalizationId = official.response.result.finalization.id;

    const [ada] = await db.select().from(schema.entries).where(eq(schema.entries.id, ids.ada));
    const requestId = randomUUID();
    const saved = await removeEntryAsAdmin(db, { ...admin, idempotencyKey: `entry-removal:${requestId}`, request: { formatVersion: 1, requestId,
      entryId: ids.ada, mode: "ANONYMIZE", expectedEntryVersion: ada!.version } }, new Date(RACE_NOW.getTime() + 120_000));
    expect(saved).toMatchObject({ status: "saved", response: { result: { outcome: "ANONYMIZED" } } });

    const list = await publicResults(db, ids.race);
    if (list.formatVersion !== 7) throw new Error("Fel format");
    expect(list.standing).toMatchObject({ kind: "OFFICIAL" });
    const xml = await exportFrozenIofResultListAsAdmin(db, { ...admin, finalizationId }, RACE_NOW);
    if (xml.status !== "ok") throw new Error(xml.status);
    const text = new TextDecoder().decode(xml.bytes);
    expect(text).toContain("<Given>Anonym</Given>");
    expect(text).not.toContain("<Given>Ada</Given>");
    expect(text).toContain("<Given>Cia</Given>");
    expect(text).not.toContain(cards.ada);
    expect(text).not.toContain("610001");
  });
});

describe("ADR-0189: gallring", () => {
  it("är av som förval; anonymiserar eller tar bort tävlingar äldre än gränsen", async () => {
    const now = new Date("2026-11-02T12:00:00Z");
    expect(retentionCutoff(now, 24)).toBe("2024-11-02");
    const old = await importedRace();
    await db.update(schema.races).set({ raceDate: "2024-06-01" }).where(eq(schema.races.id, old.raceId));
    expect(await runRetention(db, { mode: "off", months: 24 }, now)).toEqual({ anonymizedRaces: 0, anonymizedEntries: 0, deletedEvents: 0 });

    // Testdatabasen delas med andra tester: kör tills inget är kvar (högst fem tävlingar per varv).
    const until = async (mode: "anonymize" | "delete") => {
      let total = 0;
      for (let round = 0; round < 100; round++) {
        const run = await runRetention(db, { mode, months: 24 }, now);
        const done = run.anonymizedRaces + run.deletedEvents;
        if (done === 0) return total;
        total += done;
      }
      return total;
    };
    expect(await until("anonymize")).toBeGreaterThanOrEqual(1);
    const text = await raceText(old.raceId);
    expect(found(text, "Löpare")).toEqual([]);
    expect(found(text, "Skog")).toEqual([]);
    const [race] = await db.select().from(schema.races).where(eq(schema.races.id, old.raceId));
    expect(race!.personalDataRemovedAt).not.toBeNull();
    // En gång räcker.
    const again = await runRetention(db, { mode: "anonymize", months: 24 }, now);
    expect(again.anonymizedRaces).toBe(0);

    const { event, race: removable } = await createEvent(db, { name: `Gammal ${randomUUID().slice(0, 6)}`, raceName: "Gammal",
      raceDate: "2020-05-01", timeZone: "Europe/Stockholm" });
    const recent = await createEvent(db, { name: `Ny ${randomUUID().slice(0, 6)}`, raceName: "Ny", raceDate: "2026-10-01",
      timeZone: "Europe/Stockholm" });
    expect(await until("delete")).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(schema.races).where(eq(schema.races.id, removable.id))).toEqual([]);
    expect(await db.select().from(schema.races).where(eq(schema.races.id, recent.race.id))).toHaveLength(1);
    expect((await pool.query("select actor_label, reason from superadmin_action where target_id = $1", [event.id])).rows)
      .toEqual([{ actor_label: "Automatisk gallring", reason: "Gallring: tävlingen är äldre än 24 månader (OTID_RETENTION=delete)" }]);
  });
});
