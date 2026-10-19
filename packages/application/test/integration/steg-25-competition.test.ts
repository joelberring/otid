import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { getAdministratorEffectiveResult } from "../../src/administrator-effective-result";
import { listEntryTransfersAsAdmin } from "../../src/entry-transfer";
import { editClassAsAdmin } from "../../src/class-edit";
import { saveCourseDetailsAsAdmin } from "../../src/course-details";
import { setEntryStatus } from "../../src/entry-status";
import { exportIofResultListAsAdmin, exportPublicIofResultList } from "../../src/result-list-export";
import { finalizeResultsAsAdmin, listResultFinalizationCandidatesAsAdmin } from "../../src/result-finalization";
import { markRemainingDidNotStartAsAdmin, previewRemainingRunnersAsAdmin } from "../../src/remaining-runners";
import { publicResults } from "../../src/results";
import { applySyncAsAdmin, previewCourseFileAsAdmin } from "../../src/source-sync";
import { loadRaceSnapshot } from "../../src/snapshot";
import { ingest, NOW, run, seedRace } from "./steg-25-fixtures";

/**
 * PLAN.md steg 25 punkt 1, 3 och 4: startstämpling vid minutstart, maxtid, "kvar i skogen som ej start", disk med orsak,
 * banans längd och stigning, IOF-exporten och listans ställning (preliminär/officiell).
 */
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

type Admin = Awaited<ReturnType<typeof seedRace>>["admin"];
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
/** Listans ställning och klassernas banor (formatversion 7). */
const v7 = (list: Awaited<ReturnType<typeof publicResults>>) => {
  if (list.formatVersion !== 7) throw new Error("Fel format");
  return list;
};

async function effective(admin: Admin, entryId: string) {
  const result = await getAdministratorEffectiveResult(db, { ...admin, entryId }, NOW);
  if (result.status !== "ok" || result.response.state !== "ACTIVE_RESULT") throw new Error(`Inget resultat: ${result.status}`);
  return result.response;
}

async function decide(admin: Admin, entryId: string, decision: Record<string, unknown>) {
  const head = (await pool.query<{ revision: number }>("SELECT coalesce(max(revision),0) AS revision FROM result_revision WHERE entry_id=$1", [entryId])).rows[0]!;
  const requestId = randomUUID();
  return setEntryStatus(db, { ...admin, entryId, idempotencyKey: `entry-status:${requestId}`,
    request: { formatVersion: 1, requestId, expectedRevision: head.revision, decision } }, NOW);
}

describe("startstämpling vid minutstart (punkt 1)", () => {
  it("sen startstämpling är en varning på resultatet; utan lottad tid gäller startstämplingen", async () => {
    const { ids, cards, admin } = await seedRace(db, pool);
    const [ada, bo] = await ingest(db, ids.race, [run(cards.ada, "10:04:12", 40), run(cards.bo, "10:10:00", 35)]);
    expect(ada).toMatchObject({ serverResult: { status: "OK" } });
    expect(bo).toMatchObject({ serverResult: { status: "OK" } });
    const adaResult = await effective(admin, ids.ada);
    // Lottad tid 10:02:00 gäller: 40 min + 2:12.
    expect(adaResult.result).toMatchObject({ status: "OK", elapsedMs: 42 * 60_000 + 12_000 });
    expect(adaResult.notes).toEqual({ startPunch: { kind: "LATE", punchedAt: "2026-09-19T10:04:12.000Z",
      scheduledAt: "2026-09-19T10:02:00.000Z", deviationMs: 132_000 } });
    const boResult = await effective(admin, ids.bo);
    expect(boResult.result).toMatchObject({ status: "OK", elapsedMs: 35 * 60_000 });
    expect(boResult.notes).toEqual({ startPunch: { kind: "FROM_PUNCH", punchedAt: "2026-09-19T10:10:00.000Z" } });
    // Arbetsytans lista bär märkningen; den publika listan gör det aldrig.
    const roster = await listEntryTransfersAsAdmin(db, admin, NOW);
    if (roster.status !== "ok") throw new Error(roster.status);
    expect(roster.response.entries.find((row) => row.id === ids.ada)?.notes?.startPunch?.kind).toBe("LATE");
    expect(JSON.stringify(await publicResults(db, ids.race))).not.toMatch(/startPunch|LATE|FROM_PUNCH/);
  });
});

describe("maxtid per klass (punkt 3)", () => {
  it("maxtid i klassformuläret räknar om till OVERTIME: efter godkända, utan placering, OverTime i IOF", async () => {
    const { ids, cards, admin } = await seedRace(db, pool);
    await ingest(db, ids.race, [run(cards.cia, "11:00:00", 30), run(cards.dan, "11:00:00", 50)]);
    const requestId = randomUUID();
    const edit = await editClassAsAdmin(db, { ...admin, idempotencyKey: `class-edit:${requestId}`, request: { formatVersion: 1, requestId,
      classId: ids.free, className: "Öppen", courseId: ids.course, startRule: "PUNCH", maxTimeMinutes: 45, confirmResultChanges: true } }, NOW);
    if (edit.status !== "edited") throw new Error(edit.status);
    expect(edit.response).toMatchObject({ previousMaxTimeMinutes: null, recalculated: [expect.anything(), expect.anything()] });
    expect((await loadRaceSnapshot(db, ids.race)).classes.find((row) => row.id === ids.free)?.maxTimeMinutes).toBe(45);
    expect((await effective(admin, ids.dan)).result).toMatchObject({ status: "OVERTIME", reason: "MAX_TIME_EXCEEDED", elapsedMs: 50 * 60_000 });
    const listed = (await publicResults(db, ids.race)).results.filter((row) => row.className === "Öppen");
    expect(listed.map((row) => [row.givenName, row.status, "position" in row ? row.position : undefined])).toEqual([
      ["Cia", "OK", 1], ["Dan", "OVERTIME", undefined]]);
    const exported = await exportIofResultListAsAdmin(db, admin, NOW);
    if (exported.status !== "ok") throw new Error(exported.status);
    expect(text(exported.bytes)).toContain("<Status>OverTime</Status>");
    // Rogaining har egen tidsgräns; ingen maxtid där.
    await pool.query("UPDATE class SET rogaining_time_limit_seconds=1800, rogaining_penalty_points_per_minute=1, max_time_minutes=NULL WHERE id=$1", [ids.fixed]);
    const rogaining = randomUUID();
    expect((await editClassAsAdmin(db, { ...admin, idempotencyKey: `class-edit:${rogaining}`, request: { formatVersion: 1, requestId: rogaining,
      classId: ids.fixed, className: "H21", courseId: ids.course, startRule: "FIXED", maxTimeMinutes: 60, confirmResultChanges: true } }, NOW)).status)
      .toBe("invalid-request");
  });
});

describe("kvar i skogen som ej start (punkt 3)", () => {
  it("bara löpare utan avläsning och utan tecken på start; radio listas separat; idempotent", async () => {
    const { ids, cards, admin } = await seedRace(db, pool);
    await ingest(db, ids.race, [run(cards.ada, "10:02:00", 40), run(cards.cia, "11:00:00", 30)]);
    await pool.query(`INSERT INTO radio_punch(race_id,source,unit_id,punch_id,control_code,card_number,punched_at,local_time,raw_line,received_at)
      VALUES($1,'ROC','u1',1,31,$2,$3,'2026-09-19 13:10:00','rad',$3)`, [ids.race, cards.dan, "2026-09-19T11:10:00Z"]);
    const preview = await previewRemainingRunnersAsAdmin(db, admin, NOW);
    if (preview.status !== "ok") throw new Error(preview.status);
    expect(preview.response.didNotStart.map((row) => row.name).sort()).toEqual(["Bo Ek", "Eva Ek"]);
    expect(preview.response.missingAtFinish).toEqual([expect.objectContaining({ name: "Dan Ek", evidence: "RADIO", cardNumber: cards.dan })]);
    const requestId = randomUUID();
    const request = { formatVersion: 1, requestId, entryIds: preview.response.didNotStart.map((row) => row.entryId) };
    const marked = await markRemainingDidNotStartAsAdmin(db, { ...admin, idempotencyKey: `remaining-did-not-start:${requestId}`, request }, NOW);
    if (marked.status !== "saved") throw new Error(marked.status);
    expect(marked.response).toMatchObject({ replayed: false, skippedCount: 0, marked: [{ revision: 1 }, { revision: 1 }] });
    const causes = (await pool.query<{ given_name: string; cause: string; status: string }>(`SELECT e.given_name, r.cause, r.status FROM result_revision r
      JOIN entry e ON e.id=r.entry_id WHERE r.race_id=$1 AND r.cause='MANUAL_DID_NOT_START' ORDER BY e.given_name`, [ids.race])).rows;
    expect(causes).toEqual([{ given_name: "Bo", cause: "MANUAL_DID_NOT_START", status: "DNS" },
      { given_name: "Eva", cause: "MANUAL_DID_NOT_START", status: "DNS" }]);
    // Samma åtgärd igen: inget nytt. En ny åtgärd med samma löpare: de är inte kvar längre.
    const replay = await markRemainingDidNotStartAsAdmin(db, { ...admin, idempotencyKey: `remaining-did-not-start:${requestId}`, request }, NOW);
    expect(replay.status === "saved" && replay.response).toMatchObject({ replayed: true, marked: marked.response.marked });
    const again = randomUUID();
    const second = await markRemainingDidNotStartAsAdmin(db, { ...admin, idempotencyKey: `remaining-did-not-start:${again}`,
      request: { ...request, requestId: again } }, NOW);
    expect(second.status === "saved" && second.response).toMatchObject({ marked: [], skippedCount: 2 });
    expect((await pool.query("SELECT 1 FROM result_revision WHERE race_id=$1 AND cause='MANUAL_DID_NOT_START'", [ids.race])).rowCount).toBe(2);
    // Dan (radio) är orörd och ett ej start kan tas bort som vanligt.
    expect((await pool.query("SELECT 1 FROM result_revision WHERE entry_id=$1", [ids.dan])).rowCount).toBe(0);
    expect((await decide(admin, ids.bo, { kind: "WITHDRAW" })).status).toBe("decided");
  });
});

describe("disk med orsak, Eventor-id, bana och listans ställning (punkt 4)", () => {
  it("disk-orsaken lagras på revisionen och syns bara i arbetsytan; exporten och den publika listan säger bara disk", async () => {
    const { ids, cards, admin } = await seedRace(db, pool);
    await ingest(db, ids.race, [run(cards.cia, "11:00:00", 30)]);
    const decided = await decide(admin, ids.cia, { kind: "DISQUALIFIED", reason: "Genade genom tomt" });
    expect(decided.status).toBe("decided");
    expect((await pool.query("SELECT note FROM result_revision WHERE entry_id=$1 AND cause='MANUAL_DISQUALIFICATION'", [ids.cia])).rows)
      .toEqual([{ note: "Genade genom tomt" }]);
    expect((await effective(admin, ids.cia)).notes).toEqual({ disqualificationReason: "Genade genom tomt" });
    const publicList = await publicResults(db, ids.race);
    expect(publicList.results.find((row) => row.givenName === "Cia")).toMatchObject({ status: "DSQ" });
    expect(JSON.stringify(publicList)).not.toContain("Genade");
    const exported = await exportIofResultListAsAdmin(db, admin, NOW);
    if (exported.status !== "ok") throw new Error(exported.status);
    expect(text(exported.bytes)).toContain("<Status>Disqualified</Status>");
    expect(text(exported.bytes)).not.toContain("Genade");
    // Orsaken får bara finnas på disk.
    await expect(pool.query("INSERT INTO result_revision(race_id,entry_id,revision,cause,status,reason,evaluation,engine_version,snapshot_version,course_version_id,note) SELECT race_id,entry_id,99,'MANUAL_DID_NOT_START','DNS','DID_NOT_START',evaluation,engine_version,snapshot_version,course_version_id,'x' FROM result_revision WHERE entry_id=$1 LIMIT 1", [ids.cia]))
      .rejects.toThrow();
  });

  it("längd och stigning, Eventor-id, bricka och bana i IOF-exporten; officiell lista efter fastställande", async () => {
    const { ids, cards, admin } = await seedRace(db, pool);
    const detailsId = randomUUID();
    const details = await saveCourseDetailsAsAdmin(db, { ...admin, idempotencyKey: `course-details:${detailsId}`,
      request: { formatVersion: 1, requestId: detailsId, courseId: ids.course, lengthMeters: 4200, climbMeters: 120 } }, NOW);
    expect(details.status).toBe("saved");
    await ingest(db, ids.race, [run(cards.ada, "10:02:00", 40), run(cards.bo, "10:10:00", 35), run(cards.cia, "11:00:00", 30),
      run(cards.dan, "11:00:00", 31)]);
    await decide(admin, ids.eva, { kind: "DID_NOT_START" });
    const exported = await exportIofResultListAsAdmin(db, admin, NOW);
    if (exported.status !== "ok") throw new Error(exported.status);
    const xml = text(exported.bytes);
    expect(xml).toMatch(/<Person>\s*<Id type="Eventor">610001<\/Id>\s*<Name>\s*<Family>Ek<\/Family>\s*<Given>Ada<\/Given>/);
    expect(xml).toMatch(/<Organisation>\s*<Id type="Eventor">9321<\/Id>\s*<Name>OK Test<\/Name>/);
    expect(xml).toContain(`<ControlCard punchingSystem="SI">${cards.ada}</ControlCard>`);
    expect(xml).toMatch(/<Course>\s*<Name>Lång<\/Name>\s*<Length>4200<\/Length>\s*<Climb>120<\/Climb>\s*<\/Course>/);
    // Den publika exporten bär varken Eventor-id eller bricka.
    const publicXml = await exportPublicIofResultList(db, ids.race);
    if (publicXml.status !== "ok") throw new Error(publicXml.status);
    expect(text(publicXml.bytes)).not.toMatch(/610001|ControlCard/);
    const before = await publicResults(db, ids.race);
    expect(v7(before).standing).toEqual({ kind: "PRELIMINARY" });
    expect(v7(before).classCourses).toContainEqual({ className: "H21", courseName: "Lång", lengthMeters: 4200, climbMeters: 120 });

    // Fastställ klasserna och tävlingen: listan blir officiell och den fastställda filen bär samma uppgifter.
    const finalize = async (scope: "CLASS" | "RACE", classId: string | null) => {
      const candidates = await listResultFinalizationCandidatesAsAdmin(db, admin, NOW);
      if (candidates.status !== "ok") throw new Error(candidates.status);
      const candidate = scope === "RACE" ? candidates.response.race : candidates.response.classes.find((row) => row.classId === classId)!;
      expect(candidate.blockerCodes).toEqual([]);
      const requestId = randomUUID();
      const result = await finalizeResultsAsAdmin(db, { ...admin, idempotencyKey: `result-finalization:${requestId}`,
        request: { formatVersion: 1, scope, classId, expectedBasisHash: candidate.basisHash, expectedLatestScopeRevision: null } },
      { now: new Date(NOW.getTime() + 60_000) });
      if (result.status !== "finalized") throw new Error(result.status);
      return result;
    };
    await finalize("CLASS", ids.fixed);
    await finalize("CLASS", ids.free);
    await finalize("RACE", null);
    const after = await publicResults(db, ids.race);
    expect(v7(after).standing).toEqual({ kind: "OFFICIAL", finalizedAt: "2026-09-19T15:01:00.000Z", timeZone: "Europe/Stockholm" });
    const complete = (await pool.query<{ complete_xml: string }>("SELECT complete_xml FROM result_finalization WHERE race_id=$1 AND scope='RACE'", [ids.race])).rows[0]!;
    expect(complete.complete_xml).toContain('<Id type="Eventor">610001</Id>');
    expect(complete.complete_xml).toContain(`<ControlCard punchingSystem="SI">${cards.ada}</ControlCard>`);
    expect(complete.complete_xml).toMatch(/<Course>\s*<Name>Lång<\/Name>\s*<Length>4200<\/Length>/);
    // En senare ändring gör listan preliminär igen.
    await decide(admin, ids.dan, { kind: "DID_NOT_FINISH" });
    expect(v7(await publicResults(db, ids.race)).standing).toEqual({ kind: "PRELIMINARY" });
  });

  it("banfilens Length och Climb sparas på banan", async () => {
    const { admin } = await seedRace(db, pool);
    const xml = await readFile(new URL("../../../../fixtures/iof/course-file-1.xml", import.meta.url), "utf8");
    const preview = await previewCourseFileAsAdmin(db, { ...admin, xml, fileName: "banor.xml" }, NOW);
    if (preview.status !== "ok") throw new Error(preview.status);
    const requestId = randomUUID();
    const applied = await applySyncAsAdmin(db, { ...admin, idempotencyKey: `source-sync:${requestId}`, request: { formatVersion: 1, requestId,
      snapshotId: preview.response.snapshotId, excludedRowIds: [], confirmResultChanges: true } }, NOW);
    expect(applied.status).toBe("saved");
    expect((await pool.query("SELECT name, length_meters, climb_meters FROM course WHERE race_id=$1 AND name LIKE 'Bana%' ORDER BY name", [admin.raceId])).rows)
      .toEqual([{ name: "Bana 1", length_meters: 2900, climb_meters: 15 }, { name: "Bana 2", length_meters: 2300, climb_meters: 15 },
        { name: "Bana 3", length_meters: 2100, climb_meters: 15 }]);
  });
});
