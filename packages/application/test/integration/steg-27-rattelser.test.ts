import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { getAdministratorEffectiveResult } from "../../src/administrator-effective-result";
import { listEntryTransfersAsAdmin } from "../../src/entry-transfer";
import { setEntryStatus } from "../../src/entry-status";
import { ingestDeviceBatch } from "../../src/ingest";
import { contentHash } from "../../src/serialization";
import { publicResults } from "../../src/results";
import { loadRaceSnapshot } from "../../src/snapshot";
import { removeClassAsAdmin, removeCourseAsAdmin, removeEntryAsAdmin } from "../../src/race-removal";
import { readResultsOfficialAsAdmin, setResultsOfficialAsAdmin } from "../../src/result-official";
import { exportFrozenIofResultListAsAdmin } from "../../src/result-finalization";
import { exportRaceAsAdmin } from "../../src/race-export";
import { auth, ingest, NOW, RACE_DATE, run, seedRace } from "./steg-25-fixtures";

/**
 * PLAN.md steg 27: brickans stämplingar på deltagarkortet, ta bort och stryk, ta bort klass och bana, "Resultaten är klara"
 * med ångra, och "Exportera tävlingen".
 */
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

type Admin = Awaited<ReturnType<typeof seedRace>>["admin"];

async function version(entryId: string) {
  return (await pool.query<{ version: number }>("SELECT version FROM entry WHERE id=$1", [entryId])).rows[0]!.version;
}

async function removeEntry(admin: Admin, entryId: string, mode: "DELETE" | "STRIKE", requestId = randomUUID()) {
  const request = { formatVersion: 1, requestId, entryId, mode, expectedEntryVersion: await version(entryId).catch(() => 1) };
  const result = await removeEntryAsAdmin(db, { ...admin, idempotencyKey: `entry-removal:${requestId}`, request }, NOW);
  if (result.status !== "saved") throw new Error(result.status);
  return result.response;
}

async function dns(admin: Admin, entryId: string, kind = "DID_NOT_START") {
  const head = (await pool.query<{ revision: number }>("SELECT coalesce(max(revision),0) AS revision FROM result_revision WHERE entry_id=$1",
    [entryId])).rows[0]!;
  const requestId = randomUUID();
  const result = await setEntryStatus(db, { ...admin, entryId, idempotencyKey: `entry-status:${requestId}`,
    request: { formatVersion: 1, requestId, expectedRevision: head.revision, decision: { kind } } }, NOW);
  expect(result.status).toBe("decided");
}

async function official(admin: Admin, action: "OFFICIAL" | "PRELIMINARY", requestId = randomUUID()) {
  const result = await setResultsOfficialAsAdmin(db, { ...admin, idempotencyKey: `results-official:${requestId}`,
    request: { formatVersion: 1, requestId, action } }, new Date(NOW.getTime() + 60_000));
  if (result.status !== "saved") throw new Error(result.status);
  return result.response;
}

const standing = async (raceId: string) => {
  const list = await publicResults(db, raceId);
  if (list.formatVersion !== 7) throw new Error("Fel format");
  return list.standing;
};

describe("brickans stämplingar på deltagarkortet (punkt 1)", () => {
  it("en bricka med stämplingar från en annan dag och utan start visar alla stämplingar, märkta", async () => {
    const { ids, cards, admin } = await seedRace(db, pool);
    // Cia (fri start) läser ut en bricka från ett lopp i onsdags utan startstämpling: 31, 81 och 32.
    const wednesday = "2026-09-16";
    await ingest(db, ids.race, [{ cardNumber: cards.cia, finishPunchedAt: `${wednesday}T16:50:00.000Z`,
      punches: [{ code: 31, punchedAt: `${wednesday}T16:05:00.000Z` }, { code: 81, punchedAt: `${wednesday}T16:12:00.000Z` },
        { code: 32, punchedAt: `${wednesday}T16:30:00.000Z` }] } as unknown as ReturnType<typeof run>]);
    const result = await getAdministratorEffectiveResult(db, { ...admin, entryId: ids.cia }, NOW);
    if (result.status !== "ok" || result.response.state !== "ACTIVE_RESULT") throw new Error("Inget resultat");
    expect(result.response.result).toMatchObject({ status: "MP", reason: "MISSING_START" });
    const punches = result.response.cardPunches!;
    expect(punches.punches.map((row) => [row.order, row.code, row.localDate, row.placement])).toEqual([
      [1, 31, wednesday, "OTHER_DAY"], [2, 81, wednesday, "OTHER_DAY"], [3, 32, wednesday, "OTHER_DAY"]]);
    expect(punches).toMatchObject({ raceDate: RACE_DATE, otherDates: [wednesday], allOtherDay: true, noStartPunch: true,
      noFinishPunch: false, finish: { localDate: wednesday } });
    expect(punches.start).toBeUndefined();
    // En godkänd avläsning från tävlingsdagen: alla på banan, inget att anmärka.
    await ingest(db, ids.race, [run(cards.dan, "11:00:00", 30)]);
    const dan = await getAdministratorEffectiveResult(db, { ...admin, entryId: ids.dan }, NOW);
    if (dan.status !== "ok") throw new Error(dan.status);
    expect(dan.response.cardPunches).toMatchObject({ allOtherDay: false, otherDates: [], noStartPunch: false,
      punches: [{ code: 31, placement: "ON_COURSE" }, { code: 32, placement: "ON_COURSE" }] });
    // Inte avläst: inget att visa. Den publika listan bär aldrig stämplingslistan.
    const eva = await getAdministratorEffectiveResult(db, { ...admin, entryId: ids.eva }, NOW);
    expect(eva.status === "ok" && eva.response).toMatchObject({ state: "NO_PUBLISHED_RESULT", cardPunches: null });
    expect(JSON.stringify(await publicResults(db, ids.race))).not.toMatch(/OTHER_DAY|cardPunches/);
  });
});

describe("ta bort och stryk deltagare (punkt 3)", () => {
  it("utan avläsning tas deltagaren bort och brickan blir ledig; med avläsning stryks den och döljs överallt", async () => {
    const { ids, cards, admin } = await seedRace(db, pool);
    await ingest(db, ids.race, [run(cards.ada, "10:02:00", 40), run(cards.cia, "11:00:00", 30)]);
    // Bo har bricka men har inte läst ut.
    const requestId = randomUUID();
    const deleted = await removeEntry(admin, ids.bo, "DELETE", requestId);
    expect(deleted.result).toEqual({ outcome: "DELETED" });
    expect((await pool.query("SELECT 1 FROM entry WHERE id=$1", [ids.bo])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM card_assignment WHERE card_number=$1 AND race_id=$2", [cards.bo, ids.race])).rowCount).toBe(0);
    expect((await pool.query("SELECT action FROM audit_event WHERE request_id=$1", [requestId])).rows).toEqual([{ action: "ENTRY_DELETED_BY_ADMIN" }]);
    // Samma begäran igen ger samma kvitto.
    const replay = await removeEntryAsAdmin(db, { ...admin, idempotencyKey: `entry-removal:${requestId}`,
      request: deleted.request }, NOW);
    expect(replay.status === "saved" && replay.response).toMatchObject({ replayed: true, result: { outcome: "DELETED" } });

    // Ada har läst ut: borttagning stoppas, strykning går.
    expect((await removeEntry(admin, ids.ada, "DELETE")).result).toEqual({ outcome: "BLOCKED", blocker: "HAS_RESULT" });
    const struck = await removeEntry(admin, ids.ada, "STRIKE");
    expect(struck.result).toEqual({ outcome: "STRUCK" });
    expect((await pool.query("SELECT 1 FROM result_revision WHERE entry_id=$1", [ids.ada])).rowCount).toBeGreaterThan(0);
    expect((await pool.query("SELECT 1 FROM raw_device_message WHERE race_id=$1", [ids.race])).rowCount).toBe(2);
    const roster = await listEntryTransfersAsAdmin(db, admin, NOW);
    if (roster.status !== "ok") throw new Error(roster.status);
    expect(roster.response.entries.map((row) => row.id)).not.toContain(ids.ada);
    expect((await publicResults(db, ids.race)).results.map((row) => row.givenName)).toEqual(["Cia"]);
    expect((await loadRaceSnapshot(db, ids.race)).entries.map((row) => row.id)).not.toContain(ids.ada);
    // Brickan är släppt och kan kopplas till någon annan.
    await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,$3)", [ids.race, ids.eva, cards.ada]);
  });

  it("lottad tid blir vakant igen när deltagaren tas bort", async () => {
    const { ids, admin } = await seedRace(db, pool);
    const draw = randomUUID();
    await pool.query(`INSERT INTO start_draw_request(id,request_id,race_id,actor_account_id,seed,request,response,snapshot_version_before,
      snapshot_version_after,drawn_at) VALUES($1,$1,$2,$3,1,'{}','{}',1,2,$4)`, [draw, ids.race, admin.accountId, NOW]);
    await pool.query(`INSERT INTO start_draw_class(draw_id,race_id,class_id,method,first_start_time,interval_seconds,vacancy_count)
      VALUES($1,$2,$3,'MINUTE',$4,60,0)`, [draw, ids.race, ids.fixed, `${RACE_DATE}T10:02:00Z`]);
    await pool.query("INSERT INTO start_draw_slot(draw_id,class_id,position,start_time,entry_id) VALUES($1,$2,1,$3,$4)",
      [draw, ids.fixed, `${RACE_DATE}T10:02:00Z`, ids.ada]);
    expect((await removeEntry(admin, ids.ada, "DELETE")).result).toEqual({ outcome: "DELETED" });
    expect((await pool.query("SELECT entry_id FROM start_draw_slot WHERE draw_id=$1", [draw])).rows).toEqual([{ entry_id: null }]);
  });
});

describe("ta bort klass och bana (punkt 3)", () => {
  it("klass med anmälda och bana som används stoppas med besked; tomma tas bort", async () => {
    const { ids, admin } = await seedRace(db, pool);
    const removeClass = async (classId: string) => {
      const requestId = randomUUID();
      const result = await removeClassAsAdmin(db, { ...admin, idempotencyKey: `class-removal:${requestId}`,
        request: { formatVersion: 1, requestId, classId } }, NOW);
      if (result.status !== "saved") throw new Error(result.status);
      return result.response.result;
    };
    const removeCourse = async (courseId: string) => {
      const requestId = randomUUID();
      const result = await removeCourseAsAdmin(db, { ...admin, idempotencyKey: `course-removal:${requestId}`,
        request: { formatVersion: 1, requestId, courseId } }, NOW);
      if (result.status !== "saved") throw new Error(result.status);
      return result.response.result;
    };
    expect(await removeClass(ids.free)).toEqual({ outcome: "BLOCKED", blocker: "CLASS_HAS_ENTRIES", count: 3 });
    expect(await removeCourse(ids.course)).toEqual({ outcome: "BLOCKED", blocker: "COURSE_USED_BY_CLASS", names: ["H21", "Öppen"] });
    const empty = randomUUID(), course = randomUUID(), courseVersion = randomUUID();
    await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'D10',$3,'PUNCH')", [empty, ids.race, ids.version]);
    await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'Kort')", [course, ids.race]);
    await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersion, course]);
    const before = (await loadRaceSnapshot(db, ids.race)).race.snapshotVersion;
    expect(await removeClass(empty)).toEqual({ outcome: "DELETED" });
    expect(await removeCourse(course)).toEqual({ outcome: "DELETED" });
    expect((await pool.query("SELECT 1 FROM class WHERE id=$1", [empty])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM course WHERE id=$1", [course])).rowCount).toBe(0);
    expect((await loadRaceSnapshot(db, ids.race)).race.snapshotVersion).toBe(before + 2);
    // En funktionär får inte ta bort något.
    const functionary = await auth(db, ids.race, "FUNCTIONARY");
    const requestId = randomUUID();
    expect((await removeClassAsAdmin(db, { ...functionary, idempotencyKey: `class-removal:${requestId}`,
      request: { formatVersion: 1, requestId, classId: ids.free } }, NOW)).status).toBe("forbidden");
  });
});

describe("Resultaten är klara (punkt 5)", () => {
  it("en knapp fastställer hela loppet, listan blir officiell, IOF-filen finns; kan ångras och göras igen", async () => {
    const { ids, cards, admin } = await seedRace(db, pool);
    // Dan stämplade 31 före sin startstämpling: godkänd utan sträcktid där (steg 13); det får inte stoppa fastställandet.
    const early = { cardNumber: cards.dan, startPunchedAt: `${RACE_DATE}T11:00:00.000Z`, finishPunchedAt: `${RACE_DATE}T11:31:00.000Z`,
      punches: [{ code: 31, punchedAt: `${RACE_DATE}T10:58:00.000Z` }, { code: 32, punchedAt: `${RACE_DATE}T11:20:00.000Z` }] };
    await ingest(db, ids.race, [run(cards.ada, "10:02:00", 40), run(cards.cia, "11:00:00", 30), early]);
    // Bo och Eva saknar resultat: hindret säger vilka klasser.
    const blocked = await official(admin, "OFFICIAL");
    if (blocked.result.outcome !== "BLOCKED") throw new Error(blocked.result.outcome);
    expect(blocked.result.raceBlockers).toEqual([]);
    // Bara orsaken som gäller: ingen revision är inte också ett ogiltigt resultat.
    expect(blocked.result.classes.find((row) => row.className === "H21")?.blockerCodes).toEqual(["MISSING_RESULT_REVISION"]);
    expect(await standing(ids.race)).toEqual({ kind: "PRELIMINARY" });
    await dns(admin, ids.bo);
    await dns(admin, ids.eva);
    const done = await official(admin, "OFFICIAL");
    if (done.result.outcome !== "OFFICIAL") throw new Error(JSON.stringify(done.result));
    expect(done.result.finalization).toMatchObject({ scope: "RACE", entryCount: 5, classCount: 2 });
    expect(await standing(ids.race)).toMatchObject({ kind: "OFFICIAL", finalizedAt: "2026-09-19T15:01:00.000Z" });
    const xml = await exportFrozenIofResultListAsAdmin(db, { ...admin, finalizationId: done.result.finalization.id }, NOW);
    if (xml.status !== "ok") throw new Error(xml.status);
    expect(new TextDecoder().decode(xml.bytes)).toMatch(/<SplitTime status="OK">\s*<ControlCode>31<\/ControlCode>\s*<\/SplitTime>/);
    const state = await readResultsOfficialAsAdmin(db, admin, NOW);
    expect(state.status === "ok" && state.response.official).toMatchObject({ finalizationId: done.result.finalization.id, current: true });
    // Ångra: listan blir preliminär, fastställandena står kvar.
    expect((await official(admin, "PRELIMINARY")).result).toEqual({ outcome: "PRELIMINARY" });
    expect(await standing(ids.race)).toEqual({ kind: "PRELIMINARY" });
    expect((await pool.query("SELECT 1 FROM result_finalization WHERE race_id=$1 AND scope='RACE'", [ids.race])).rowCount).toBe(1);
    // Igen: inget har ändrats i klasserna, så bara loppet fastställs på nytt.
    const again = await official(admin, "OFFICIAL");
    expect(again.result.outcome).toBe("OFFICIAL");
    expect((await pool.query("SELECT scope, count(*)::int AS n FROM result_finalization WHERE race_id=$1 GROUP BY scope ORDER BY scope",
      [ids.race])).rows).toEqual([{ scope: "CLASS", n: 2 }, { scope: "RACE", n: 2 }]);
    // En ändring efteråt gör listan preliminär tills arrangören trycker igen.
    await dns(admin, ids.dan, "DID_NOT_FINISH");
    expect(await standing(ids.race)).toEqual({ kind: "PRELIMINARY" });
    const changed = await readResultsOfficialAsAdmin(db, admin, NOW);
    expect(changed.status === "ok" && changed.response.official?.current).toBe(false);
  });
});

describe("Exportera tävlingen (punkt 6)", () => {
  it("filen har formatet, banor, klasser, anmälda, råa avläsningar med ramar och resultatrevisioner", async () => {
    const { ids, cards, admin } = await seedRace(db, pool);
    const frame = "02d30d00071234567890abcdef03";
    const payload = { cardNumber: cards.ada, cardType: "SI9" as const, startPunchedAt: `${RACE_DATE}T10:02:00.000Z`,
      finishPunchedAt: `${RACE_DATE}T10:42:00.000Z`, punches: [{ code: 31, punchedAt: `${RACE_DATE}T10:15:00.000Z` },
        { code: 32, punchedAt: `${RACE_DATE}T10:30:00.000Z` }], untimedPunchCodes: [], frames: [frame], simulated: false };
    const deviceId = randomUUID();
    const ack = await ingestDeviceBatch(db, ids.race, { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 1, lastSequence: 1,
      events: [{ localSequence: 1, stationReceivedAt: `${RACE_DATE}T10:43:00.000Z`, transport: "sportident", payload,
        contentHash: contentHash(payload) }] });
    expect(ack.acknowledgements[0]?.status).toBe("stored");
    const exported = await exportRaceAsAdmin(db, admin, NOW);
    if (exported.status !== "ok") throw new Error(exported.status);
    expect(exported.fileName).toBe(`otid-steg-25-${RACE_DATE}.json`);
    const file = JSON.parse(new TextDecoder().decode(exported.bytes)) as Record<string, unknown[]> & { format: string; formatVersion: number;
      race: { id: string } };
    expect(file).toMatchObject({ format: "otid-race-export", formatVersion: 1, race: { id: ids.race } });
    expect(file.courses).toHaveLength(1);
    expect(file.courseControls).toHaveLength(2);
    expect(file.classes).toHaveLength(2);
    expect(file.entries).toHaveLength(5);
    expect(file.cardAssignments).toHaveLength(4);
    const raw = file.rawReadouts as { raw_payload: { frames: string[] } }[];
    expect(raw.map((row) => row.raw_payload.frames)).toEqual([[frame]]);
    expect(file.resultRevisions).toEqual([expect.objectContaining({ entry_id: ids.ada, status: "OK", cause: "CARD_READOUT" })]);
    for (const section of ["maps", "participantRoutes", "radioPunches", "auditEvents", "startDrawSlots", "resultFinalizations"]) {
      expect(Array.isArray(file[section])).toBe(true);
    }
    expect(JSON.stringify(file)).not.toMatch(/ciphertext|password|session_token/);
    // Bara administratören.
    const functionary = await auth(db, ids.race, "FUNCTIONARY");
    expect((await exportRaceAsAdmin(db, functionary, NOW)).status).toBe("forbidden");
  });
});
