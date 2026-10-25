import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import {
  ingestDeviceBatch, listResultRecalculationCandidatesAsAdmin, listUnknownReadoutResolutionCandidatesAsAdmin, publicResults, registerReadoutCard, resolveUnknownReadoutAsAdmin
} from "../../src";
import { recalculateEntry } from "../../src/result-recalculation";
import { raceAuth } from "./accounts";
import { statusFlow } from "./entry-status-helpers";
import { batch, db, importedRace, okPayload, useRaceDatabase } from "./race-fixtures";

/**
 * Steg 31 (B4): samma bricka hos två löpare. Ada läser ut sin bricka; sedan springer någon annan med den. Den andra
 * avläsningen skriver inte över Adas resultat utan blir okänd ("redan avläst för Ada") tills den kopplas.
 */
useRaceDatabase();
const { entryId, revisions } = statusFlow(db);
const second = { ...okPayload, startPunchedAt: "2026-08-30T11:00:00Z", finishPunchedAt: "2026-08-30T11:50:00Z",
  punches: [31, 32, 33].map((code, index) => ({ code, punchedAt: `2026-08-30T11:${10 + index * 10}:00Z` })) };

async function race() {
  const { raceId } = await importedRace();
  const admin = await raceAuth(db, raceId);
  const ada = await entryId(raceId, "Ada"), bo = await entryId(raceId, "Bo");
  const [first] = (await ingestDeviceBatch(db, raceId, batch(randomUUID(), okPayload))).acknowledgements;
  expect(first).toMatchObject({ status: "stored", serverResult: { status: "OK" } });
  return { raceId, admin, ada, bo };
}
const row = async (raceId: string, givenName: string) =>
  (await publicResults(db, raceId)).results.find((result) => result.givenName === givenName);
const activeCard = async (entry: string) => (await db.select({ card: schema.cardAssignments.cardNumber }).from(schema.cardAssignments)
  .where(and(eq(schema.cardAssignments.entryId, entry), eq(schema.cardAssignments.active, true))).orderBy(asc(schema.cardAssignments.id)))
  .map((value) => value.card);

describe("steg 31: samma bricka hos två löpare", () => {
  it("skriver inte över den förstes resultat; en exakt dubblett ger samma resultat", async () => {
    const { raceId, admin, ada } = await race();
    // Samma avläsning igen på en annan dator: samma resultat som förut.
    const [duplicate] = (await ingestDeviceBatch(db, raceId, batch(randomUUID(), okPayload))).acknowledgements;
    expect(duplicate).toMatchObject({ status: "stored", serverResult: { status: "OK", revision: 2 } });
    // En annan löpare med samma bricka: okänd, ingen ny revision för Ada.
    const [borrowed] = (await ingestDeviceBatch(db, raceId, batch(randomUUID(), second))).acknowledgements;
    expect(borrowed).toMatchObject({ status: "stored", serverResult: { status: "UNKNOWN_CARD" } });
    expect((await revisions(ada)).map((value) => value.cause)).toEqual(["CARD_READOUT", "CARD_READOUT"]);
    expect(await row(raceId, "Ada")).toMatchObject({ status: "OK", elapsedMs: 2_400_000 });
    const listed = await listUnknownReadoutResolutionCandidatesAsAdmin(db, admin);
    if (listed.status !== "ok") throw new Error(listed.status);
    expect(listed.response.readouts).toHaveLength(1);
    expect(listed.response.readouts[0]).toMatchObject({ cardNumber: "12345", alreadyReadOutBy: { entryId: ada } });
    expect(listed.response.readouts[0]?.alreadyReadOutBy?.name).toContain("Ada");
  });

  it("kopplar den andra avläsningen till en annan anmäld; brickan flyttas och omräkning flyttar inga resultat", async () => {
    const { raceId, admin, ada, bo } = await race();
    await ingestDeviceBatch(db, raceId, batch(randomUUID(), second));
    const listed = await listUnknownReadoutResolutionCandidatesAsAdmin(db, admin);
    if (listed.status !== "ok") throw new Error(listed.status);
    const readout = listed.response.readouts[0]!;
    const boRow = listed.response.entries.find((entry) => entry.id === bo)!;
    const requestId = randomUUID();
    const resolved = await resolveUnknownReadoutAsAdmin(db, { ...admin, idempotencyKey: `unknown-readout-resolution:${requestId}`,
      request: { formatVersion: 1, requestId, target: "EXISTING_ENTRY", readoutId: readout.id, cardNumber: "12345",
        expectedEngineVersion: listed.response.engineVersion, entryId: bo, expectedEntryVersion: boRow.entryVersion,
        expectedClassId: boRow.classId, expectedAssignment: boRow.activeAssignment, expectedLatestResultRevision: null } });
    expect(resolved).toMatchObject({ status: "resolved", response: { entryId: bo, status: "OK" } });
    expect(await activeCard(bo)).toEqual(["12345"]);
    expect(await activeCard(ada)).toEqual([]);
    expect(await row(raceId, "Ada")).toMatchObject({ status: "OK", elapsedMs: 2_400_000 });
    expect(await row(raceId, "Bo")).toMatchObject({ status: "OK", elapsedMs: 3_000_000 });

    // Omräkning: var och en från sin egen avläsning, även Ada som inte längre har brickan.
    await recalculateEntry(db, raceId, ada);
    await recalculateEntry(db, raceId, bo);
    const adaReadout = (await revisions(ada)).at(-1)!.readoutId, boReadout = (await revisions(bo)).at(-1)!.readoutId;
    expect(adaReadout).not.toBe(boReadout);
    expect(boReadout).toBe(readout.id);
    expect(await row(raceId, "Ada")).toMatchObject({ elapsedMs: 2_400_000 });
    expect(await row(raceId, "Bo")).toMatchObject({ elapsedMs: 3_000_000 });
  });

  it("det är samma löpare: den nya avläsningen gäller", async () => {
    const { raceId, admin, ada } = await race();
    await ingestDeviceBatch(db, raceId, batch(randomUUID(), second));
    const listed = await listUnknownReadoutResolutionCandidatesAsAdmin(db, admin);
    if (listed.status !== "ok") throw new Error(listed.status);
    const adaRow = listed.response.entries.find((entry) => entry.id === ada)!;
    const requestId = randomUUID();
    const resolved = await resolveUnknownReadoutAsAdmin(db, { ...admin, idempotencyKey: `unknown-readout-resolution:${requestId}`,
      request: { formatVersion: 1, requestId, target: "EXISTING_ENTRY", readoutId: listed.response.readouts[0]!.id, cardNumber: "12345",
        expectedEngineVersion: listed.response.engineVersion, entryId: ada, expectedEntryVersion: adaRow.entryVersion,
        expectedClassId: adaRow.classId, expectedAssignment: adaRow.activeAssignment, expectedLatestResultRevision: adaRow.latestResultRevision } });
    expect(resolved).toMatchObject({ status: "resolved", response: { entryId: ada } });
    expect(await row(raceId, "Ada")).toMatchObject({ elapsedMs: 3_000_000 });
    expect(await activeCard(ada)).toEqual(["12345"]);
  });

  it("direktanmälan på avläsningssidan med lånad bricka skapar den nya löparen och lämnar den förste orörd", async () => {
    const { raceId, ada } = await race();
    await ingestDeviceBatch(db, raceId, batch(randomUUID(), second));
    const functionary = await raceAuth(db, raceId, "FUNCTIONARY");
    // Samma klass som Ada (banan 31-32-33); utan urval kommer klasserna i godtycklig ordning.
    const [klass] = await db.select({ id: schema.entries.classId }).from(schema.entries).where(eq(schema.entries.id, ada));
    const register = async (borrowedCard: boolean) => {
      const requestId = randomUUID();
      return registerReadoutCard(db, { ...functionary, idempotencyKey: `readout-registration:${requestId}`, request: {
        formatVersion: 1, requestId, cardNumber: "12345", classId: klass!.id, givenName: "Lina", familyName: "Lånad",
        organisationName: null, ...(borrowedCard ? { borrowedCard: true } : {}) } });
    };
    // Utan valet "lånad bricka": brickan hör till Ada, men hennes resultat skrivs inte över.
    expect(await register(false)).toMatchObject({ status: "registered", response: { outcome: "EXISTING", entryId: ada, linkedResult: null } });
    expect(await row(raceId, "Ada")).toMatchObject({ elapsedMs: 2_400_000 });
    expect(await register(true)).toMatchObject({ status: "registered", response: { outcome: "CREATED",
      linkedResult: { status: "OK" } } });
    expect(await row(raceId, "Lina")).toMatchObject({ status: "OK", elapsedMs: 3_000_000 });
    expect(await row(raceId, "Ada")).toMatchObject({ status: "OK", elapsedMs: 2_400_000 });
  });
});

describe("steg 45: omräkning tar aldrig någon annans avläsning", () => {
  async function moveCardToBo(ada: string, bo: string, raceId: string) {
    // Brickan flyttas till Bo utan att någon avläsning kopplas (som "Byt bricka" i deltagarkortet).
    for (const entry of [ada, bo]) await db.update(schema.cardAssignments).set({ active: false }).where(eq(schema.cardAssignments.entryId, entry));
    await db.insert(schema.cardAssignments).values({ raceId, entryId: bo, cardNumber: "12345", active: true });
  }

  it("den som får Adas bricka efteråt räknas inte om från Adas avläsning", async () => {
    const { raceId, admin, ada, bo } = await race();
    await moveCardToBo(ada, bo, raceId);
    const listed = await listResultRecalculationCandidatesAsAdmin(db, admin);
    if (listed.status !== "ok") throw new Error(listed.status);
    expect(listed.response.entries.find((entry) => entry.id === bo)).toMatchObject({ readiness: "NO_READOUT", latestReadout: null });
    await expect(recalculateEntry(db, raceId, bo)).rejects.toThrow("Deltagaren saknar avläsning");
    expect(await revisions(bo)).toEqual([]);
    // Ada räknas fortfarande om från sin egen avläsning.
    await recalculateEntry(db, raceId, ada);
    expect(await row(raceId, "Ada")).toMatchObject({ status: "OK", elapsedMs: 2_400_000 });
  });

  it("en lånad bricka som ingen har kopplats till går fortfarande att räkna om för den som får brickan", async () => {
    const { raceId, admin, ada, bo } = await race();
    const [borrowed] = (await ingestDeviceBatch(db, raceId, batch(randomUUID(), second, { stationReceivedAt: "2026-08-30T11:51:00Z" })))
      .acknowledgements;
    expect(borrowed).toMatchObject({ serverResult: { status: "UNKNOWN_CARD" } });
    await moveCardToBo(ada, bo, raceId);
    const listed = await listResultRecalculationCandidatesAsAdmin(db, admin);
    if (listed.status !== "ok") throw new Error(listed.status);
    expect(listed.response.entries.find((entry) => entry.id === bo)).toMatchObject({ readiness: "READY" });
    await recalculateEntry(db, raceId, bo);
    expect(await row(raceId, "Bo")).toMatchObject({ status: "OK", elapsedMs: 3_000_000 });
    expect(await row(raceId, "Ada")).toMatchObject({ status: "OK", elapsedMs: 2_400_000 });
  });
});
