import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { NATT_KM_CODES } from "../../../sportident/test/fixtures/siac-natt-km";
import { applyReadoutRereadAsAdmin, getAdministratorEffectiveResult, previewReadoutRereadAsAdmin, publicResults } from "../../src";
import { raceAuth } from "./accounts";
import { statusFlow } from "./entry-status-helpers";
import { db, useRaceDatabase } from "./race-fixtures";
import { CARDS, correctPayload, nightRace, oldFrames, oldPayload, send, toHex } from "./reread-fixtures";

/** Steg 36: läs om avläsningar från rådata (underlaget i `reread-fixtures.ts`). */
useRaceDatabase();
const { decide, revisions } = statusFlow(db);
const readoutsOf = (raceId: string, card: number) => db.select().from(schema.cardReadouts)
  .where(and(eq(schema.cardReadouts.raceId, raceId), eq(schema.cardReadouts.cardNumber, String(card))))
  .orderBy(asc(schema.cardReadouts.readAt));
const publicRow = async (raceId: string, givenName: string) =>
  (await publicResults(db, raceId)).results.find((row) => row.givenName === givenName);

async function preview(auth: Awaited<ReturnType<typeof raceAuth>>, entryId?: string) {
  const result = await previewReadoutRereadAsAdmin(db, { ...auth, request: { formatVersion: 1, ...(entryId ? { entryId } : {}) } });
  if (result.status !== "ok") throw new Error(result.status);
  return result.response;
}

describe("steg 36: läs om avläsningar från rådata", () => {
  it("natt-KM: Ada får kvällens 14 stämplingar, godkänd 53:23; Bo (rätt avläst) och övningsstationen listas inte", async () => {
    const ids = await nightRace();
    const admin = await raceAuth(db, ids.race);
    await send(ids.race, [oldPayload(CARDS.ada), correctPayload(CARDS.bo), oldPayload(CARDS.cia, undefined, true)]);
    expect(await publicRow(ids.race, "Ada")).toMatchObject({ status: "MP" });
    expect(await publicRow(ids.race, "Bo")).toMatchObject({ status: "OK", elapsedMs: 3_203_000 });
    const [original] = await readoutsOf(ids.race, CARDS.ada);
    const [originalRaw] = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.id, original!.rawMessageId));

    const listed = await preview(admin);
    expect(listed.checkedCount).toBe(2);
    expect(listed.unreadable).toEqual([]);
    expect(listed.items).toHaveLength(1);
    const [item] = listed.items;
    expect(item).toMatchObject({ entryId: ids.ada, readoutId: original!.id, cardNumber: String(CARDS.ada), displayName: "Ada Test",
      className: "H21", before: { punchCount: original!.punches.length, status: "MP" },
      after: { punchCount: 14, status: "OK", elapsedMs: 3_203_000 }, manualDecision: null });
    // Samma för en deltagare (deltagarkortet).
    expect((await preview(admin, ids.ada)).items).toEqual([item]);
    expect((await preview(admin, ids.bo)).items).toEqual([]);

    const requestId = randomUUID();
    const commit = (request: unknown) => applyReadoutRereadAsAdmin(db, { ...admin, request });
    const saved = await commit({ formatVersion: 1, requestId, items: [{ readoutId: item!.readoutId, entryId: item!.entryId,
      itemHash: item!.itemHash }] });
    expect(saved).toMatchObject({ status: "applied", response: { replayed: false, saved: [{ entryId: ids.ada, replacedReadoutId: original!.id }] } });
    if (saved.status !== "applied") throw new Error(saved.status);

    // En ny avläsning med kvällens stämplingar, start 18:47:56 och mål 19:41:19 svensk tid.
    const readouts = await readoutsOf(ids.race, CARDS.ada);
    expect(readouts).toHaveLength(2);
    const reread = readouts[1]!;
    expect(reread.id).toBe(saved.response.saved[0]!.readoutId);
    expect(reread.punches.map((punch) => punch.code)).toEqual(NATT_KM_CODES);
    expect(reread.startPunchedAt?.toISOString()).toBe("2026-10-20T16:47:56.000Z");
    expect(reread.finishPunchedAt?.toISOString()).toBe("2026-10-20T17:41:19.000Z");
    expect(reread.readAt.getTime()).toBe(original!.readAt.getTime() + 1);
    // Originalet och dess råmeddelande är oförändrade; det nya råmeddelandet pekar på originalet.
    expect(readouts[0]).toEqual(original);
    expect((await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.id, originalRaw!.id)))[0]).toEqual(originalRaw);
    const [rawReread] = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.id, reread.rawMessageId));
    expect(rawReread).toMatchObject({ transport: "sportident-reread", deviceId: originalRaw!.id, localSequence: 1,
      stationReceivedAt: originalRaw!.stationReceivedAt,
      rawPayload: { rereadOf: { rawMessageId: originalRaw!.id, replacesReadoutId: original!.id }, simulated: false } });

    const adaRevisions = await revisions(ids.ada);
    expect(adaRevisions.map((row) => [row.cause, row.status])).toEqual([["CARD_READOUT", "MP"], ["READOUT_REREAD", "OK"]]);
    expect(adaRevisions[1]).toMatchObject({ readoutId: reread.id, actorAccountId: admin.actorId, evaluation: { elapsedMs: 3_203_000 } });
    expect(await publicRow(ids.race, "Ada")).toMatchObject({ status: "OK", elapsedMs: 3_203_000 });
    const effective = await getAdministratorEffectiveResult(db, { ...admin, entryId: ids.ada });
    expect(effective).toMatchObject({ status: "ok", response: { history: [{ cause: "READOUT_REREAD", status: "OK" }, { cause: "CARD_READOUT" }],
      cardPunches: { readAt: reread.readAt.toISOString() } } });
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId));
    expect(audit).toEqual([expect.objectContaining({ action: "READOUT_REREAD_BY_ADMIN", entityType: "card_readout", entityId: reread.id,
      actorId: admin.actorId })]);

    // Idempotens: samma begäran ger samma kvitto; en ny omläsning hittar inget och ger inga nya avläsningar.
    expect(await commit({ formatVersion: 1, requestId, items: [{ readoutId: item!.readoutId, entryId: item!.entryId,
      itemHash: item!.itemHash }] })).toMatchObject({ status: "applied", response: { replayed: true, saved: saved.response.saved } });
    expect((await preview(admin)).items).toEqual([]);
    expect(await commit({ formatVersion: 1, requestId: randomUUID(), items: [{ readoutId: item!.readoutId, entryId: item!.entryId,
      itemHash: item!.itemHash }] })).toEqual({ status: "conflict" });
    expect(await readoutsOf(ids.race, CARDS.ada)).toHaveLength(2);
    expect(await revisions(ids.ada)).toHaveLength(2);
  });

  it("råramar som inte går att avkoda listas som 'går inte att läsa om' och ger inga stämplingar", async () => {
    const ids = await nightRace();
    const admin = await raceAuth(db, ids.race);
    const corrupt = oldFrames(CARDS.dan).map(toHex);
    corrupt[5] = corrupt[5]!.slice(0, 40) + (corrupt[5]![40] === "0" ? "1" : "0") + corrupt[5]!.slice(41);
    const missing = oldFrames(CARDS.eva).slice(0, 5).map(toHex);
    await send(ids.race, [oldPayload(CARDS.dan, corrupt), oldPayload(CARDS.eva, missing)]);
    const listed = await preview(admin);
    expect(listed.items).toEqual([]);
    expect(listed.unreadable.map((row) => [row.displayName, row.reason])).toEqual([["Dan Test", "FRAMES"], ["Eva Test", "FRAMES"]]);
    expect(listed.unreadable[0]!.detail).toMatch(/kontrollsumma/);
    expect(listed.unreadable[1]!.detail).toMatch(/Ofullständig/);
    expect(await readoutsOf(ids.race, CARDS.dan)).toHaveLength(1);
  });

  it("ett manuellt beslut ligger kvar över omläsningen och visas i förhandsbeskedet", async () => {
    const ids = await nightRace();
    const admin = await raceAuth(db, ids.race);
    await send(ids.race, [oldPayload(CARDS.ada)]);
    expect(await decide(admin, ids.ada, { kind: "MANUAL_TIME", finishTime: "2026-10-20T19:45:00+02:00", status: "OK",
      note: "Fel stämplingar från avläsningen" })).toMatchObject({ status: "decided" });
    const [item] = (await preview(admin)).items;
    expect(item).toMatchObject({ entryId: ids.ada, manualDecision: "MANUAL_TIME", after: { status: "OK", punchCount: 14 } });
    const saved = await applyReadoutRereadAsAdmin(db, { ...admin, request: { formatVersion: 1, requestId: randomUUID(),
      items: [{ readoutId: item!.readoutId, entryId: item!.entryId, itemHash: item!.itemHash }] } });
    expect(saved.status).toBe("applied");
    expect((await revisions(ids.ada)).map((row) => row.cause)).toEqual(["CARD_READOUT", "MANUAL_TIME", "READOUT_REREAD"]);
    expect(await getAdministratorEffectiveResult(db, { ...admin, entryId: ids.ada })).toMatchObject({ status: "ok",
      response: { governingDecision: "MANUAL_TIME" } });
    // "Ta bort manuell tid": omläsningen gäller.
    expect(await decide(admin, ids.ada, { kind: "WITHDRAW" })).toMatchObject({ status: "decided" });
    expect(await publicRow(ids.race, "Ada")).toMatchObject({ status: "OK", elapsedMs: 3_203_000 });
  });

  it("bara administratören: funktionären och den utan session får inget, och inget sparas", async () => {
    const ids = await nightRace();
    const admin = await raceAuth(db, ids.race);
    const functionary = await raceAuth(db, ids.race, "FUNCTIONARY");
    await send(ids.race, [oldPayload(CARDS.ada)]);
    const [item] = (await preview(admin)).items;
    const request = { formatVersion: 1, requestId: randomUUID(), items: [{ readoutId: item!.readoutId, entryId: item!.entryId,
      itemHash: item!.itemHash }] };
    expect(await previewReadoutRereadAsAdmin(db, { ...functionary, request: { formatVersion: 1 } })).toEqual({ status: "forbidden" });
    expect(await applyReadoutRereadAsAdmin(db, { ...functionary, request })).toEqual({ status: "forbidden" });
    expect(await applyReadoutRereadAsAdmin(db, { raceId: ids.race, sessionToken: null, request })).toEqual({ status: "unauthorized" });
    expect(await applyReadoutRereadAsAdmin(db, { ...admin, request: { ...request, items: [{ ...request.items[0]!, itemHash: "0".repeat(64) }] } }))
      .toEqual({ status: "conflict" });
    expect(await applyReadoutRereadAsAdmin(db, { ...admin, request: { formatVersion: 1 } })).toEqual({ status: "invalid-request" });
    expect(await readoutsOf(ids.race, CARDS.ada)).toHaveLength(1);
  });
});
