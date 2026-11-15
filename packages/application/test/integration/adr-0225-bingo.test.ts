import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { placeShips } from "@o-tid/domain";
import { listPublicRaces, readBingoAsAdmin, readBingoLeaderboard, readBingoPublic, receiveBingoProgress, setBingoAsAdmin } from "../../src";
import { auth, NOW, RACE_DATE, seedRace } from "./steg-25-fixtures";

/** ADR-0225: bingoorientering med telefonen. Påhittade namn. */
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

/** Ett banläggningsdokument med två grupper (bana 1 och 2) i 1:10 000; område 30 × 20 mm. */
const document = {
  version: 1, event: { title: "Bingo", mapScale: 10_000 },
  courses: [{ id: "1", name: "Gröna", kind: "NORMAL", order: 1 }, { id: "2", name: "Blå", kind: "NORMAL", order: 2 }],
  training: { schemaVersion: 1, areas: {}, attackPoints: {}, courses: {
    "1": { outside: { kind: "FULL" }, sections: [], bingo: { area: { minX: 0, minY: 0, maxX: 30, maxY: 20 }, cellMeters: 100 } },
    "2": { outside: { kind: "FULL" }, sections: [], bingo: { area: { minX: 0, minY: 0, maxX: 30, maxY: 20 }, cellMeters: 200 } } } }
};

async function bingoRace(options: { published?: boolean } = {}) {
  const seeded = await seedRace(db, pool);
  await pool.query("UPDATE race SET published_at=$2, race_type='TRAINING' WHERE id=$1", [seeded.ids.race, options.published === false ? null : NOW]);
  await pool.query("INSERT INTO course_setting(race_id, document, version, updated_at, updated_by) VALUES($1,$2,1,$3,$4)",
    [seeded.ids.race, JSON.stringify(document), NOW, randomUUID()]);
  const admin = await auth(db, seeded.ids.race, "ADMIN");
  return { raceId: seeded.ids.race, admin };
}

const start = NOW.getTime() - 20 * 60_000;
const progress = (runnerId: string, overrides: Record<string, unknown> = {}) => ({ formatVersion: 1, runnerId, name: "Lisa L", group: "1",
  status: "RUNNING", startedAt: start, finishedAt: null, distanceM: 800, taken: [{ cell: "A1", at: start + 60_000 }],
  track: [[5, 15, start + 60_000]], gaps: [], ...overrides });
const send = (raceId: string, request: unknown, options: { now?: Date; staff?: boolean } = {}) =>
  receiveBingoProgress(db, { raceId, clientKey: "198.51.100.4", request, staff: options.staff ?? false }, options.now ?? NOW);

describe("bingo med telefonen (ADR-0225)", () => {
  it("admin slår på; löparen skickar sitt läge flera gånger (idempotent); topplistan och ledarens vy", async () => {
    const { raceId, admin } = await bingoRace();
    expect(await send(raceId, progress(randomUUID()))).toEqual({ status: "not-found" });
    const enabled = await setBingoAsAdmin(db, { ...admin, request: { formatVersion: 1, enabled: true } }, NOW);
    expect(enabled.status).toBe("ok");
    const lisa = randomUUID();
    expect(await send(raceId, progress(lisa))).toMatchObject({ status: "ok", response: { cells: 1 } });
    // Samma läge igen, ett äldre läge och sedan mål med fler rutor och en okänd ruta.
    expect(await send(raceId, progress(lisa))).toMatchObject({ status: "ok", response: { cells: 1 } });
    expect(await send(raceId, progress(lisa, { status: "FINISHED", finishedAt: start + 600_000, distanceM: 1500,
      taken: [{ cell: "A1", at: start + 60_000 }, { cell: "B2", at: start + 300_000 }, { cell: "Q9", at: start + 400_000 }] }))).toMatchObject({ response: { cells: 2 } });
    expect(await send(raceId, progress(lisa, { distanceM: 900 }))).toMatchObject({ response: { cells: 2 } });
    await send(raceId, progress(randomUUID(), { name: "Kim K", taken: [{ cell: "A1", at: start + 30_000 }, { cell: "B1", at: start + 90_000 },
      { cell: "C1", at: start + 120_000 }] }));
    await send(raceId, progress(randomUUID(), { name: "Bo B", group: "2", taken: [] }));
    const board = await readBingoLeaderboard(db, { raceId, staff: false }, NOW);
    expect(board?.groups.map(group => [group.name, group.cells, group.runners.map(row => [row.name, row.cells, row.status])])).toEqual([
      ["Gröna", 6, [["Kim K", 3, "RUNNING"], ["Lisa L", 2, "FINISHED"]]],
      ["Blå", 2, [["Bo B", 0, "RUNNING"]]]
    ]);
    expect(board?.groups[0]!.runners[1]).toMatchObject({ seconds: 600, distanceM: 1500 });
    // Topplistan har inga spår; ledarens vy har dem.
    expect(JSON.stringify(board)).not.toContain("track");
    const view = await readBingoAsAdmin(db, admin, NOW);
    expect(view.status === "ok" && view.response.runners.find(row => row.name === "Lisa L")).toMatchObject({ status: "FINISHED", distanceM: 1500,
      track: [[5, 15, start + 60_000]] });
    const functionary = await auth(db, raceId, "FUNCTIONARY");
    expect((await readBingoAsAdmin(db, functionary, NOW)).status).toBe("forbidden");
  });

  it("bara träningsdagen (utom för arrangören); opublicerat ger not-found för andra; fel form och okänd grupp avvisas", async () => {
    const { raceId, admin } = await bingoRace();
    await setBingoAsAdmin(db, { ...admin, request: { formatVersion: 1, enabled: true } }, NOW);
    const dayAfter = new Date(`2026-09-20T12:00:00Z`);
    expect(await send(raceId, progress(randomUUID()), { now: dayAfter })).toEqual({ status: "closed" });
    expect((await send(raceId, progress(randomUUID()), { now: dayAfter, staff: true })).status).toBe("ok");
    expect((await readBingoPublic(db, { raceId, staff: false }, dayAfter)).status).toBe("closed");
    expect(await send(raceId, progress(randomUUID(), { group: "9" }))).toEqual({ status: "invalid-request" });
    expect(await send(raceId, progress(randomUUID(), { name: "  " }))).toEqual({ status: "invalid-request" });
    expect(await send(raceId, { formatVersion: 1 })).toEqual({ status: "invalid-request" });
    const hidden = await bingoRace({ published: false });
    await setBingoAsAdmin(db, { ...hidden.admin, request: { formatVersion: 1, enabled: true } }, NOW);
    expect(await send(hidden.raceId, progress(randomUUID()))).toEqual({ status: "not-found" });
    expect((await send(hidden.raceId, progress(randomUUID()), { staff: true })).status).toBe("ok");
  });

  it("startsidan: bingon syns bara på dagen, inte i Kommande eller Senaste", async () => {
    const { raceId, admin } = await bingoRace();
    const name = `Bingo ${randomUUID().slice(0, 8)}`;
    await pool.query("UPDATE event SET name=$2 WHERE id=(SELECT event_id FROM race WHERE id=$1)", [raceId, name]);
    const listed = async (now: Date) => {
      const listing = await listPublicRaces(db, { search: name }, now);
      return [listing.ongoing, listing.upcoming, listing.recent].map(list => list.some(row => row.raceId === raceId));
    };
    expect(await listed(new Date(`2026-09-17T12:00:00Z`))).toEqual([false, true, false]);
    await setBingoAsAdmin(db, { ...admin, request: { formatVersion: 1, enabled: true } }, NOW);
    expect(await listed(NOW)).toEqual([true, false, false]);
    expect(await listed(new Date(`2026-09-17T12:00:00Z`))).toEqual([false, false, false]);
    expect(await listed(new Date(`2026-09-21T12:00:00Z`))).toEqual([false, false, false]);
    expect(RACE_DATE).toBe("2026-09-19");
  });

  it("Sänka skepp: läget per träning, fröet behålls, skotten bedöms på servern och topplistan har poängen", async () => {
    const { raceId, admin } = await bingoRace();
    const set = await setBingoAsAdmin(db, { ...admin, request: { formatVersion: 1, enabled: true, mode: "SHIPS" } }, NOW);
    expect(set.status === "ok" && set.response.mode).toBe("SHIPS");
    const names = ["A1", "B1", "C1", "A2", "B2", "C2"];
    const ships = placeShips(names, [2, 1], 77);
    expect(ships.flatMap(ship => ship.cells)).toHaveLength(3);
    // Rutornas mitt (1:10 000, 10 mm rutor, området 0–30 × 0–20 mm, A1 uppe till vänster).
    const center = (name: string) => { const column = name.charCodeAt(0) - 65, row = Number(name.slice(1)) - 1; return { x: column * 10 + 5, y: 20 - row * 10 - 5 }; };
    const hitCell = ships[0]!.cells[0]!;
    const water = names.find(name => !ships.some(ship => ship.cells.includes(name)))!;
    const shots = [{ cell: hitCell, at: start + 60_000, ...center(hitCell), accuracyM: 8 }, { cell: water, at: start + 120_000, ...center(water), accuracyM: 6 },
      { cell: hitCell === "A1" ? "C2" : "A1", at: start + 180_000, ...center(hitCell), accuracyM: 6 }];
    const runner = randomUUID();
    expect(await send(raceId, progress(runner, { name: "Sam S", seed: 77, shots, taken: [] }))).toMatchObject({ status: "ok", response: { seed: 77 } });
    // Ett annat frö senare ändrar inget.
    expect(await send(raceId, progress(runner, { name: "Sam S", seed: 5, shots: shots.slice(0, 1), taken: [] }))).toMatchObject({ response: { seed: 77 } });
    const board = await readBingoLeaderboard(db, { raceId, staff: false }, NOW);
    expect(board?.mode).toBe("SHIPS");
    expect(board?.groups[0]!.runners[0]).toMatchObject({ name: "Sam S", hits: 1, wrong: 1, points: 1 - 1 + (ships[0]!.cells.length === 1 ? 2 : 0) });
    const view = await readBingoAsAdmin(db, admin, NOW);
    const row = view.status === "ok" ? view.response.runners.find(item => item.name === "Sam S") : undefined;
    expect(row?.ships).toEqual(ships.map(ship => ship.cells));
    expect(row?.shots.map(item => item.result)).toEqual([ships[0]!.cells.length === 1 ? "SUNK" : "HIT", "WATER", "WRONG"]);
  });
});
