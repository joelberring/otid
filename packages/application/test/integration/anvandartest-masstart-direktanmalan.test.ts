import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { RESULT_ENGINE_VERSION } from "@o-tid/domain";
import { registerReadoutCard } from "../../src/readout-registration";
import { readReadoutPackageAsAdmin } from "../../src/readout-station";
import { listUnknownReadoutResolutionCandidatesAsAdmin, resolveUnknownReadoutAsAdmin } from "../../src/unknown-readout-resolution";
import { getAdministratorEffectiveResult } from "../../src/administrator-effective-result";
import { forkedRace, MASS_START, readout, type Proof } from "./anvandartest-block1-fixtures";

/**
 * Användartestet 2026-11-12, fel A: en ny löpare i en klass med masstart får masstartens tid, oavsett om hen
 * direktanmäls i avläsningsvyn (med eller utan nät) eller i kontrollvyn. Varianten som stämplingarna passar sparas även när
 * anmälan kom före avläsningen (utan nät). Minutstart ändras inte: där gäller startstämplingen.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_block1a_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_block1a_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

function registration(classId: string, cardNumber: string, givenName: string) {
  const requestId = randomUUID();
  return { idempotencyKey: `readout-registration:${requestId}`, request: { formatVersion: 1 as const, requestId, cardNumber, classId,
    givenName, familyName: "Ny", organisationName: null } };
}

async function entry(entryId: string) {
  return (await pool.query<{ fixed_start_time: Date | null; course_variant_code: string | null }>(
    "select fixed_start_time, course_variant_code from entry where id = $1", [entryId])).rows[0]!;
}

async function result(proof: Proof, entryId: string) {
  const read = await getAdministratorEffectiveResult(db, { ...proof, entryId });
  if (read.status !== "ok" || read.response.state !== "ACTIVE_RESULT") throw new Error("Resultatet saknas");
  const value = read.response.result;
  return { status: value.status, elapsedMs: "elapsedMs" in value ? value.elapsedMs : undefined, notes: read.response.notes };
}

describe("användartestet 2026-11-12, fel A: direktanmäld i en klass med masstart", () => {
  it("avläsningsvyn med nät (avläsningen först): masstartens tid och varianten efter stämplingarna", async () => {
    const { proof, classes } = await forkedRace(db, pool);
    const ack = await readout(db, pool, proof, "7505001", "BD");
    expect(ack).toMatchObject({ serverResult: { status: "UNKNOWN_CARD" } });
    const registered = await registerReadoutCard(db, { ...proof, ...registration(classes.H21, "7505001", "Nätt") });
    if (registered.status !== "registered") throw new Error(registered.status);
    expect(registered.response).toMatchObject({ outcome: "CREATED", linkedResult: { status: "OK" } });
    expect(await entry(registered.response.entryId)).toEqual({ fixed_start_time: new Date(MASS_START), course_variant_code: "BD" });
    // Tiden räknas från masstarten som för de andra i klassen, inte från startstämplingen 07:08:21.
    const value = await result(proof, registered.response.entryId);
    expect(value).toMatchObject({ status: "OK", elapsedMs: 30 * 60_000 });
    expect(value.notes?.startPunch?.kind).not.toBe("FROM_PUNCH");
  });

  it("utan nät (anmälan först, sedan avläsningen, som kön skickar dem): masstartens tid och sparad variant", async () => {
    const { proof, classes } = await forkedRace(db, pool);
    // Paketet bär masstarten så att avläsningsvyn bedömer rätt redan utan nät.
    const pkg = await readReadoutPackageAsAdmin(db, proof);
    if (pkg.status !== "ok") throw new Error("Paketet saknas");
    expect(pkg.response.massStarts).toEqual([{ classId: classes.H21, startTime: MASS_START }]);
    const registered = await registerReadoutCard(db, { ...proof, ...registration(classes.H21, "7505002", "Offline") });
    if (registered.status !== "registered") throw new Error(registered.status);
    expect(registered.response).toMatchObject({ outcome: "CREATED", linkedResult: null });
    expect(await entry(registered.response.entryId)).toEqual({ fixed_start_time: new Date(MASS_START), course_variant_code: null });
    const ack = await readout(db, pool, proof, "7505002", "BD");
    expect(ack).toMatchObject({ serverResult: { status: "OK" } });
    expect(await entry(registered.response.entryId)).toEqual({ fixed_start_time: new Date(MASS_START), course_variant_code: "BD" });
    expect(await result(proof, registered.response.entryId)).toMatchObject({ status: "OK", elapsedMs: 30 * 60_000 });
  });

  it("kontrollvyns Ny direktanmälan får masstartens tid; minutstart får ingen tid (startstämplingen gäller)", async () => {
    const { proof, classes } = await forkedRace(db, pool);
    await readout(db, pool, proof, "7505003", "AC");
    const listed = await listUnknownReadoutResolutionCandidatesAsAdmin(db, proof);
    if (listed.status !== "ok") throw new Error("Okända brickor saknas");
    const unknown = listed.response.readouts.find(row => row.cardNumber === "7505003")!;
    const h21 = listed.response.classes.find(row => row.id === classes.H21)!;
    const requestId = randomUUID();
    const resolved = await resolveUnknownReadoutAsAdmin(db, { ...proof, idempotencyKey: `unknown-readout-resolution:${requestId}`,
      request: { formatVersion: 1, requestId, readoutId: unknown.id, cardNumber: "7505003", expectedEngineVersion: RESULT_ENGINE_VERSION,
        target: "NEW_ENTRY", classId: h21.id, expectedCourseVersionId: h21.courseVersionId, givenName: "Kontroll", familyName: "Ny",
        organisationName: null } });
    if (resolved.status !== "resolved") throw new Error(resolved.status);
    expect(await entry(resolved.response.entryId)).toEqual({ fixed_start_time: new Date(MASS_START), course_variant_code: "AC" });
    expect(await result(proof, resolved.response.entryId)).toMatchObject({ status: "OK", elapsedMs: 30 * 60_000 });

    // D21 har minutstart: den direktanmälda saknar lottad tid och tiden räknas från startstämplingen, som förut.
    const minute = await registerReadoutCard(db, { ...proof, ...registration(classes.D21, "7505004", "Minut") });
    if (minute.status !== "registered") throw new Error(minute.status);
    expect((await entry(minute.response.entryId)).fixed_start_time).toBeNull();
  });
});
