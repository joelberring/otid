import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { setEntryStatus } from "../../src/entry-status";
import { publicRaceAccess } from "../../src/public-race-visibility";
import { NEW_LEADER_WINDOW_MS, readPublicLive } from "../../src/public-live";
import { setRacePublicationAsAdmin } from "../../src/race-publication";
import { removeEntryAsAdmin } from "../../src/race-removal";
import { ingest, NOW, run, seedRace } from "./steg-25-fixtures";

/**
 * PLAN.md steg 30: Live för publiken mot PostgreSQL. Grinden (opublicerad och dold syns inte), målgångarna nyaste först med
 * placering, felstämplad utan placering, ej start och strukna borta, ledare per klass med "Ny ledare" och inga bricknummer
 * eller interna id:n i svaret.
 */
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

type Seed = Awaited<ReturnType<typeof seedRace>>;

function leaves(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(leaves);
  return [value];
}

async function strike({ admin }: Seed, entryId: string) {
  const { rows } = await pool.query<{ version: number }>("SELECT version FROM entry WHERE id=$1", [entryId]);
  const requestId = randomUUID();
  const result = await removeEntryAsAdmin(db, { ...admin, idempotencyKey: `entry-removal:${requestId}`,
    request: { formatVersion: 1, requestId, entryId, mode: "STRIKE", expectedEntryVersion: rows[0]!.version } }, NOW);
  expect(result.status === "saved" && result.response.result).toEqual({ outcome: "STRUCK" });
}

async function didNotStart({ admin }: Seed, entryId: string) {
  const requestId = randomUUID();
  const result = await setEntryStatus(db, { ...admin, entryId, idempotencyKey: `entry-status:${requestId}`,
    request: { formatVersion: 1, requestId, expectedRevision: 0, decision: { kind: "DID_NOT_START" } } }, NOW);
  expect(result.status).toBe("decided");
}

describe("Live för publiken (PLAN.md steg 30)", () => {
  it("syns bara när tävlingen är publicerad och inte dold, som de andra publika sidorna", async () => {
    const seed = await seedRace(db, pool);
    const raceId = seed.ids.race;
    expect(await publicRaceAccess(db, raceId, null)).toBe("NONE");
    expect(await publicRaceAccess(db, raceId, seed.admin.sessionToken, NOW)).toBe("PREVIEW");
    expect((await setRacePublicationAsAdmin(db, { ...seed.admin, published: true }, NOW)).status).toBe("saved");
    expect(await publicRaceAccess(db, raceId, null)).toBe("PUBLIC");
    await pool.query("UPDATE race SET hidden_by_superadmin=true WHERE id=$1", [raceId]);
    expect(await publicRaceAccess(db, raceId, null)).toBe("NONE");
    expect(await publicRaceAccess(db, raceId, seed.admin.sessionToken, NOW)).toBe("NONE");
    await pool.query("UPDATE race SET hidden_by_superadmin=false WHERE id=$1", [raceId]);

    // Före första målgången: tomt men giltigt.
    expect(await readPublicLive(db, raceId)).toMatchObject({ raceId, timeZone: "Europe/Stockholm", finishes: [], leaders: [],
      radio: { enabled: false, latest: [], onTheWay: [] } });
  });

  it("visar målgångarna nyaste först, ledarna per klass och utesluter ej start och strukna", async () => {
    const seed = await seedRace(db, pool);
    const { ids, cards } = seed;
    const raceId = ids.race;
    await ingest(db, raceId, [run(cards.ada, "10:02:00", 40)]);
    await ingest(db, raceId, [run(cards.cia, "11:00:00", 30)]);
    // Dan stämplar inte 32: felstämplad.
    const dan = run(cards.dan, "11:05:00", 25);
    await ingest(db, raceId, [{ ...dan, punches: dan.punches.filter(punch => punch.code !== 32) }]);
    await didNotStart(seed, ids.eva);

    const now = new Date();
    const live = await readPublicLive(db, raceId, now);
    expect(live.finishes.map(row => [row.givenName, row.className, row.status, row.place, row.elapsedMs])).toEqual([
      ["Dan", "Öppen", "MP", undefined, undefined], ["Cia", "Öppen", "OK", 1, 30 * 60_000], ["Ada", "H21", "OK", 1, 40 * 60_000]]);
    expect(live.finishes.every(row => Date.parse(row.finishedAt) <= now.getTime())).toBe(true);
    expect(live.leaders.map(row => [row.className, row.givenName, row.newLeader])).toEqual([["H21", "Ada", true], ["Öppen", "Cia", true]]);
    const later = await readPublicLive(db, raceId, new Date(now.getTime() + NEW_LEADER_WINDOW_MS + 60_000));
    expect(later.leaders.map(row => row.newLeader)).toEqual([false, false]);

    // Inga bricknummer eller interna id:n, jämfört som hela värden.
    const values = leaves(live);
    for (const card of Object.values(cards)) {
      expect(values).not.toContain(card);
      expect(values).not.toContain(Number(card));
    }
    for (const entryId of [ids.ada, ids.bo, ids.cia, ids.dan, ids.eva, ids.fixed, ids.free, ids.course, ids.version, ids.event]) {
      expect(values).not.toContain(entryId);
    }
    expect(JSON.stringify(live)).not.toMatch(/"(cardNumber|entryId|reason|rankingState|revision)"/);

    // Cia stryks: borta ur Live, även som ledare. Dan är felstämplad, så Öppen har ingen ledare.
    await strike(seed, ids.cia);
    const afterStrike = await readPublicLive(db, raceId);
    expect(afterStrike.finishes.map(row => row.givenName)).toEqual(["Dan", "Ada"]);
    expect(afterStrike.leaders.map(row => row.givenName)).toEqual(["Ada"]);
  });
});
