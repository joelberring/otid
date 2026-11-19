import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { DEFAULT_SETTINGS, newGame, scoreGuess, type CardGame } from "@o-tid/domain/mastermind";
import { anonymizeRace, readMastermindAsStaff, readMastermindStandings, receiveMastermindStation, setMastermindStationsAsAdmin, syncMastermindAsStaff } from "../../src";
import { auth, NOW, seedRace } from "./steg-25-fixtures";

/** ADR-0228: Mastermind med kontroller sparas på servern. Påhittade lagnamn. */
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function training(options: { raceType?: string; published?: boolean } = {}) {
  const seeded = await seedRace(db, pool);
  await pool.query("UPDATE race SET published_at=$2, race_type=$3 WHERE id=$1",
    [seeded.ids.race, options.published === false ? null : NOW, options.raceType ?? "TRAINING"]);
  return { raceId: seeded.ids.race, admin: await auth(db, seeded.ids.race, "ADMIN"), functionary: await auth(db, seeded.ids.race, "FUNCTIONARY") };
}

const SECRET = [0, 1, 2, 3];
const minute = (n: number) => new Date(NOW.getTime() - 60 * 60_000 + n * 60_000);
const guess = (colors: number[], at: number) => ({ colors, score: scoreGuess(SECRET, colors), at: minute(at).toISOString() });
function game(cardNumber: number, start: number, guesses: ReturnType<typeof guess>[] = []): CardGame {
  return { ...newGame(cardNumber, DEFAULT_SETTINGS, minute(start), { id: () => randomUUID() }), secret: SECRET, guesses };
}
const state = (games: CardGame[], names: Record<string, { name: string; at: string }> = {}, extra: Record<string, unknown> = {}) =>
  ({ formatVersion: 1, settings: DEFAULT_SETTINGS, games, names, ...extra });
const sync = (proof: Awaited<ReturnType<typeof auth>>, request: unknown) => syncMastermindAsStaff(db, { ...proof, request }, NOW);

describe("Mastermind med kontroller på servern (ADR-0228)", () => {
  it("två datorer: spelen slås ihop per id, svaren räknas om ur mönstret och samma läge två gånger ändrar inget", async () => {
    const { raceId, admin, functionary } = await training();
    const solved = game(1_200_002, 0, [guess([1, 0, 2, 3], 2), guess([0, 1, 2, 3], 5)]);
    // Datorn påstår att den första gissningen var rätt; servern räknar om.
    const forged = { ...solved, guesses: [{ ...solved.guesses[0]!, score: { exact: 4, colorOnly: 0 } }, solved.guesses[1]!] };
    const first = await sync(admin, state([forged], { "1200002": { name: "Rävarna", at: minute(1).toISOString() } }));
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;
    expect(first.response.games[0]!.guesses.map(item => item.score.exact)).toEqual([2, 4]);
    expect(first.response.games[0]!.finishedAt).toBe(minute(5).toISOString());

    // Den andra datorn (funktionären) har ett eget spel och en gissning till på ett spel den hämtat.
    const playing = game(9_150_186, 3);
    const later = { ...playing, guesses: [guess([3, 2, 1, 0], 8)] };
    await sync(functionary, state([playing]));
    const second = await sync(functionary, state([later], { "9150186": { name: "Ugglorna", at: minute(4).toISOString() } }));
    expect(second.status === "ok" && second.response.games.map(item => [item.cardNumber, item.guesses.length])).toEqual([[1_200_002, 2], [9_150_186, 1]]);
    expect(second.status === "ok" && Object.keys(second.response.names).sort()).toEqual(["1200002", "9150186"]);

    // Samma läge igen ger samma svar och inga nya rader.
    const again = await sync(functionary, state([later]));
    expect(again).toEqual(second);
    const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM mastermind_game WHERE race_id=$1", [raceId]);
    expect(rows[0]?.n).toBe(2);
    const read = await readMastermindAsStaff(db, admin, NOW);
    expect(read.status === "ok" && second.status === "ok" && read.response.games).toEqual(second.status === "ok" && second.response.games);
    // Administratören får slå på "Spela på egen dator", funktionären inte.
    expect(read.status === "ok" && [read.response.openStations, read.response.canOpen]).toEqual([false, true]);
    expect(second.status === "ok" && second.response.canOpen).toBe(false);
  });

  it("den publika ställningen: namn och brickans sista siffror, inga mönster; bara träningsdagen och bara med spel", async () => {
    const { raceId, admin } = await training();
    expect(await readMastermindStandings(db, { raceId, staff: false }, NOW)).toBeUndefined();
    const abandoned = { ...game(5_000_001, 1), abandonedAt: minute(2).toISOString() };
    await sync(admin, state([game(1_200_002, 0, [guess([0, 1, 2, 3], 4)]), game(9_150_186, 1), abandoned],
      { "1200002": { name: "Rävarna", at: minute(1).toISOString() } }));
    const standings = await readMastermindStandings(db, { raceId, staff: false }, NOW);
    expect(standings?.openStations).toBe(false);
    expect(standings?.rows).toEqual([
      { name: "Rävarna", cardEnd: "002", status: "won", guesses: 1, place: 1, durationMs: 4 * 60_000 },
      { cardEnd: "186", status: "playing", guesses: 0, startedAt: minute(1).toISOString() }
    ]);
    expect(JSON.stringify(standings)).not.toContain("secret");
    expect(JSON.stringify(standings)).not.toContain("1200002");
    const dayAfter = new Date("2026-09-20T12:00:00Z");
    expect(await readMastermindStandings(db, { raceId, staff: false }, dayAfter)).toBeUndefined();
    expect(await readMastermindStandings(db, { raceId, staff: true }, dayAfter)).toBeDefined();
  });

  it("de senaste inställningarna gäller; ogiltiga spel hoppas över; fel form, CSRF och tävlingstyp prövas", async () => {
    const { admin } = await training();
    const three = { ...DEFAULT_SETTINGS, positions: 3 };
    await sync(admin, state([], {}, { settings: three, settingsAt: minute(2).toISOString() }));
    const older = await sync(admin, state([{ ...game(1, 0), secret: [0, 0, 1, 2] }], {}, { settingsAt: minute(1).toISOString() }));
    expect(older.status === "ok" && [older.response.settings.positions, older.response.games.length]).toEqual([3, 0]);
    expect(await sync(admin, { formatVersion: 1 })).toEqual({ status: "invalid-request" });
    expect(await sync({ ...admin, csrfHeader: "fel" }, state([]))).toEqual({ status: "forbidden" });
    const race = await training({ raceType: "STANDARD" });
    expect(await sync(race.admin, state([]))).toEqual({ status: "not-found" });
    expect(await readMastermindStandings(db, { raceId: race.raceId, staff: true }, NOW)).toBeUndefined();
  });

  it("gallringen tar bort spelen och namnen", async () => {
    const { raceId, admin } = await training();
    await sync(admin, state([game(1_200_002, 0)], { "1200002": { name: "Rävarna", at: minute(1).toISOString() } }));
    await db.transaction(tx => anonymizeRace(tx, raceId, NOW));
    const games = await pool.query("SELECT 1 FROM mastermind_game WHERE race_id=$1", [raceId]);
    const races = await pool.query("SELECT 1 FROM mastermind_race WHERE race_id=$1", [raceId]);
    expect([games.rowCount, races.rowCount]).toEqual([0, 0]);
  });

  it("spela på egen dator: av som förval; administratören slår på; datorn ändrar bara sina egna spel och ser bara dem", async () => {
    const { raceId, admin, functionary } = await training();
    const key = "a".repeat(43), other = "b".repeat(43);
    const station = (stationKey: string, games: CardGame[], names: Record<string, { name: string; at: string }> = {}, extra: Record<string, unknown> = {}) =>
      receiveMastermindStation(db, { raceId, clientKey: "198.51.100.7", request: { formatVersion: 1, stationKey, games, names, ...extra }, staff: false }, NOW);
    const staffGame = game(1_200_002, 0, [guess([1, 0, 2, 3], 2)]);
    await sync(admin, state([staffGame]));
    expect(await station(key, [])).toEqual({ status: "closed" });
    expect((await setMastermindStationsAsAdmin(db, { ...functionary, request: { formatVersion: 1, open: true } }, NOW)).status).toBe("forbidden");
    const opened = await setMastermindStationsAsAdmin(db, { ...admin, request: { formatVersion: 1, open: true } }, NOW);
    expect(opened.status === "ok" && opened.response.openStations).toBe(true);

    const own = game(9_150_186, 1, [guess([0, 1, 2, 3], 3)]);
    const forged = { ...staffGame, guesses: [...staffGame.guesses, guess([0, 1, 2, 3], 4)] };
    const wrongSettings = { ...game(5_000_001, 1), settings: { ...DEFAULT_SETTINGS, maxGuesses: 20 } };
    const sent = await station(key, [own, forged, wrongSettings], { "9150186": { name: "Ugglorna", at: minute(1).toISOString() },
      "1200002": { name: "Kapat", at: minute(9).toISOString() } });
    expect(sent.status).toBe("ok");
    if (sent.status !== "ok") return;
    // Bara datorns eget spel och namn kommer tillbaka; arrangörens spel (och mönster) aldrig.
    expect(sent.response.games.map(item => item.cardNumber)).toEqual([9_150_186]);
    expect(sent.response.names).toEqual({ "9150186": { name: "Ugglorna", at: minute(1).toISOString() } });
    expect(sent.response.settings).toEqual(DEFAULT_SETTINGS);
    expect(sent.response.shortCode).toMatch(/^[2-9a-hjkmnp-z]{6}$/);
    // En annan dator kan inte ta över spelet; arrangörens spel och namn är orörda.
    const stolen = await station(other, [{ ...own, abandonedAt: minute(5).toISOString(), guesses: [] }]);
    expect(stolen.status === "ok" && stolen.response.games).toEqual([]);
    const all = await readMastermindAsStaff(db, admin, NOW);
    expect(all.status === "ok" && all.response.games.map(item => [item.cardNumber, item.guesses.length, item.abandonedAt ?? null])).toEqual([
      [1_200_002, 1, null], [9_150_186, 1, null]]);
    expect(all.status === "ok" && all.response.names["1200002"]).toBeUndefined();
    // Ställningen visar datorns spel och att knappen ska synas.
    const standings = await readMastermindStandings(db, { raceId, staff: false }, NOW);
    expect(standings).toMatchObject({ openStations: true, rows: [{ name: "Ugglorna", status: "won" }, { cardEnd: "002", status: "playing" }] });
    // Fällan sparar inget; dagen efter och avslaget är stängt.
    expect((await station(key, [game(7_000_001, 2)], {}, { website: "x" })).status).toBe("ok");
    expect((await readMastermindStandings(db, { raceId, staff: false }, NOW))?.rows).toHaveLength(2);
    expect(await receiveMastermindStation(db, { raceId, clientKey: "198.51.100.7", request: { formatVersion: 1, stationKey: key, games: [], names: {} },
      staff: false }, new Date("2026-09-20T12:00:00Z"))).toEqual({ status: "closed" });
    await setMastermindStationsAsAdmin(db, { ...admin, request: { formatVersion: 1, open: false } }, NOW);
    expect(await station(key, [])).toEqual({ status: "closed" });
    expect(await station("kort", [])).toEqual({ status: "invalid-request" });
  });
});
