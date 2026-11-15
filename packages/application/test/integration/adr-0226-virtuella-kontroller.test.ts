import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyEdit, emptyDocument, type CourseSettingDocument, type CourseSettingEdit } from "@o-tid/course-setting";
import { createDatabase, migrate } from "@o-tid/database";
import { readBingoAsAdmin, readBingoLeaderboard, readBingoPublic, receiveBingoProgress, setBingoAsAdmin } from "../../src";
import { auth, NOW, seedRace } from "./steg-25-fixtures";

/** ADR-0226: virtuella kontroller (vanlig bana, poängbana och duell). Påhittade namn. */
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

/** 1:10 000 (10 m per mm): start (0,0), 31 (10,0), 32 (20,0), mål (20,10). Bana 1 vanlig, bana 2 poängbana. */
function courseDocument(): CourseSettingDocument {
  let document = emptyDocument({ title: "Virtuella", mapScale: 10_000 });
  const edit = (change: CourseSettingEdit) => { const result = applyEdit(document, change); document = result.document; return result.created; };
  // En ensam start och ett ensamt mål läggs in på nya banor av sig själva.
  edit({ type: "ADD_CONTROL", kind: "START", at: { x: 0, y: 0 } });
  const a = edit({ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 10, y: 0 }, code: "31" })!;
  const b = edit({ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 20, y: 0 }, code: "32" })!;
  edit({ type: "ADD_CONTROL", kind: "FINISH", at: { x: 20, y: 10 } });
  for (const [name, kind] of [["Lång", "NORMAL"], ["Poäng", "SCORE"]] as const) {
    const course = edit({ type: "ADD_COURSE", name, kind })!;
    for (const control of [a, b]) edit({ type: "INSERT_COURSE_CONTROL", course, control });
  }
  return document;
}

async function controlsRace() {
  const seeded = await seedRace(db, pool);
  await pool.query("UPDATE race SET published_at=$2, race_type='TRAINING' WHERE id=$1", [seeded.ids.race, NOW]);
  await pool.query("INSERT INTO course_setting(race_id, document, version, updated_at, updated_by) VALUES($1,$2,1,$3,$4)",
    [seeded.ids.race, JSON.stringify(courseDocument()), NOW, randomUUID()]);
  const admin = await auth(db, seeded.ids.race, "ADMIN");
  const set = await setBingoAsAdmin(db, { ...admin, request: { formatVersion: 1, enabled: true, mode: "CONTROLS",
    settings: { radiusM: 25, punch: "AUTO", points: { 32: 20 } } } }, NOW);
  return { raceId: seeded.ids.race, admin, set };
}

const start = NOW.getTime() - 30 * 60_000;
const at = (code: "31" | "32" | "M", dx = 0) => code === "31" ? { x: 10 + dx, y: 0 } : code === "32" ? { x: 20 + dx, y: 0 } : { x: 20 + dx, y: 10 };

describe("virtuella kontroller (ADR-0226)", () => {
  it("banorna ur banläggningen; vanlig bana i ordning, fel ordning och utanför radien räknas inte; duell med lag", async () => {
    const { raceId, admin, set } = await controlsRace();
    expect(set.status === "ok" && set.response.courses?.map(course => [course.name, course.order, course.controls.map(control => control.code)])).toEqual([
      ["Lång", "ORDERED", ["S", "31", "32", "M"]], ["Poäng", "SCORE", ["S", "31", "32", "M"]]]);
    const read = await readBingoPublic(db, { raceId, staff: false }, NOW);
    const ids = read.status === "ok" ? Object.fromEntries(read.setup.courses[0]!.controls.map(control => [control.code, control.id])) : {};
    const course = read.status === "ok" ? read.setup.courses[0]!.course : "";
    const punch = (code: "31" | "32" | "M", time: number, dx = 0) => ({ control: ids[code]!, at: start + time * 1000, ...at(code, dx), accuracyM: 5 });
    const send = (runnerId: string, name: string, punches: unknown[], extra: Record<string, unknown> = {}) => receiveBingoProgress(db, {
      raceId, clientKey: "198.51.100.9", staff: false, request: { formatVersion: 1, runnerId, name, group: course, status: "RUNNING", startedAt: start,
        finishedAt: null, distanceM: 1000, taken: [], track: [], gaps: [], punches, ...extra } }, NOW);
    const sara = randomUUID(), kim = randomUUID(), bo = randomUUID();
    // Sara (Röda) tar 32 först i fel ordning (räknas inte), sedan 31, 32 och mål; 31 utanför radien (30 m) räknas inte.
    expect((await send(sara, "Sara S", [punch("32", 60), punch("31", 120), punch("32", 200), punch("M", 300)], { duel: "AB12", team: "Röda" })).status).toBe("ok");
    expect((await send(kim, "Kim K", [punch("31", 100, 3)], { duel: "AB12", team: "Röda" })).status).toBe("ok");
    expect((await send(bo, "Bo B", [punch("31", 90), punch("32", 250)], { duel: "AB12", team: "Blå" })).status).toBe("ok");
    expect((await send(randomUUID(), "Fel", [], { group: "999" })).status).toBe("invalid-request");
    const board = await readBingoLeaderboard(db, { raceId, staff: false }, NOW);
    expect(board?.mode).toBe("CONTROLS");
    const duel = board?.duels?.[0];
    // 31: Blå först (90 s) 10 p, Röda tvåa 3 p. 32 (ledaren satte 20): Röda först (200 s) 20 p, Blå tvåa 6 p.
    expect(duel?.teams).toEqual([{ team: "Röda", points: 23, runners: ["Kim K", "Sara S"] }, { team: "Blå", points: 16, runners: ["Bo B"] }]);
    expect(duel?.taken.map(item => [item.code, item.team, item.runner, item.points])).toEqual([["31", "Blå", "Bo B", 10], ["31", "Röda", "Sara S", 3],
      ["32", "Röda", "Sara S", 20], ["32", "Blå", "Bo B", 6]]);
    expect(JSON.stringify(board)).not.toContain("\"x\"");
    const view = await readBingoAsAdmin(db, admin, NOW);
    const saraRow = view.status === "ok" ? view.response.runners.find(row => row.name === "Sara S") : undefined;
    expect(saraRow?.punches?.map(item => [item.code, item.fromStartMs])).toEqual([["31", 120_000], ["32", 200_000], ["M", 300_000]]);
    expect(saraRow).toMatchObject({ duel: "AB12", team: "Röda", controls: 2 });
  });
});
