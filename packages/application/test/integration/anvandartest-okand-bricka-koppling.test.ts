import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { RESULT_ENGINE_VERSION } from "@o-tid/domain";
import { listUnknownReadoutResolutionCandidatesAsAdmin, resolveUnknownReadoutAsAdmin } from "../../src/unknown-readout-resolution";
import { getAdministratorEffectiveResult } from "../../src/administrator-effective-result";
import { entryIds, forkedRace, readout, type Proof } from "./anvandartest-block1-fixtures";

/**
 * Användartestet 2026-11-12, fel B: en okänd bricka kopplas i kontrollvyn till en löpare som redan har ett resultat.
 * Servern litar inte på klienten: utan `replaceExistingResult: true` avvisas kopplingen och inget ändras. Med medgivandet
 * ersätts resultatet, och deltagarkortets historik säger vad som ersattes (bricka före och efter, tidigare resultat).
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_block1b_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_block1b_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

/** Kontrollvyns begäran för att koppla den okända avläsningen av brickan till deltagaren, så som listan visar läget. */
async function linkRequest(proof: Proof, cardNumber: string, entryId: string) {
  const listed = await listUnknownReadoutResolutionCandidatesAsAdmin(db, proof);
  if (listed.status !== "ok") throw new Error("Okända brickor saknas");
  const unknown = listed.response.readouts.find(row => row.cardNumber === cardNumber)!;
  const entry = listed.response.entries.find(row => row.id === entryId)!;
  const requestId = randomUUID();
  return { entry, idempotencyKey: `unknown-readout-resolution:${requestId}`, request: { formatVersion: 1 as const, requestId,
    readoutId: unknown.id, cardNumber, expectedEngineVersion: RESULT_ENGINE_VERSION, target: "EXISTING_ENTRY" as const, entryId,
    expectedEntryVersion: entry.entryVersion, expectedClassId: entry.classId, expectedAssignment: entry.activeAssignment,
    expectedLatestResultRevision: entry.latestResultRevision } };
}

async function activeCard(entryId: string) {
  return (await pool.query<{ card_number: string }>("select card_number from card_assignment where entry_id = $1 and active", [entryId]))
    .rows.map(row => row.card_number);
}

async function history(proof: Proof, entryId: string) {
  const read = await getAdministratorEffectiveResult(db, { ...proof, entryId });
  if (read.status !== "ok") throw new Error(read.status);
  return read.response.history;
}

describe("användartestet 2026-11-12, fel B: koppla en okänd bricka till en löpare som redan har resultat", () => {
  it("servern avvisar utan uttryckligt medgivande, ersätter med det och historiken säger vad som ersattes", async () => {
    const { proof } = await forkedRace(db, pool);
    const ids = await entryIds(pool, proof.raceId);
    // Cia (AD, bricka 8101003) har läst ut och är godkänd på 30:00 efter masstarten.
    expect(await readout(db, pool, proof, "8101003", "AD")).toMatchObject({ serverResult: { status: "OK" } });
    expect(await readout(db, pool, proof, "7505442", "AD", { minutes: 41 })).toMatchObject({ serverResult: { status: "UNKNOWN_CARD" } });

    const linking = await linkRequest(proof, "7505442", ids.Cia!);
    // Listan visar Cias nuvarande resultat, så att kontrollvyn kan varna.
    expect(linking.entry).toMatchObject({ activeAssignment: { cardNumber: "8101003" }, latestResult: { status: "OK", elapsedMs: 30 * 60_000 },
      readOut: true });
    const refused = await resolveUnknownReadoutAsAdmin(db, { ...proof, idempotencyKey: linking.idempotencyKey, request: linking.request });
    expect(refused).toEqual({ status: "result-exists" });
    expect(await activeCard(ids.Cia!)).toEqual(["8101003"]);
    expect((await history(proof, ids.Cia!)).map(row => row.cause)).toEqual(["CARD_READOUT"]);

    const resolved = await resolveUnknownReadoutAsAdmin(db, { ...proof, idempotencyKey: linking.idempotencyKey,
      request: { ...linking.request, replaceExistingResult: true } });
    if (resolved.status !== "resolved") throw new Error(resolved.status);
    expect(resolved.response).toMatchObject({ status: "OK", entryId: ids.Cia });
    expect(await activeCard(ids.Cia!)).toEqual(["7505442"]);
    const [latest, first] = await history(proof, ids.Cia!);
    expect(latest).toMatchObject({ cause: "UNKNOWN_READOUT_RESOLUTION", status: "OK",
      link: { cardBefore: "8101003", cardAfter: "7505442", replacedResult: { status: "OK", elapsedMs: 30 * 60_000 } } });
    expect(first).toMatchObject({ cause: "CARD_READOUT" });
    expect(first).not.toHaveProperty("link");
  });

  it("en löpare utan resultat men med en annan bricka kopplas utan medgivande; historiken säger brickbytet", async () => {
    const { proof } = await forkedRace(db, pool);
    const ids = await entryIds(pool, proof.raceId);
    await readout(db, pool, proof, "7505443", "BD");
    const linking = await linkRequest(proof, "7505443", ids.Fia!);
    const resolved = await resolveUnknownReadoutAsAdmin(db, { ...proof, idempotencyKey: linking.idempotencyKey, request: linking.request });
    expect(resolved.status).toBe("resolved");
    expect(await history(proof, ids.Fia!)).toEqual([expect.objectContaining({ cause: "UNKNOWN_READOUT_RESOLUTION",
      link: { cardBefore: "8101006", cardAfter: "7505443", replacedResult: null } })]);
  });
});
