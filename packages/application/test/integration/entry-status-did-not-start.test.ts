import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { getAdministratorEffectiveResult, ingestDeviceBatch, publicResults } from "../../src";
import { raceAuth } from "./accounts";
import { personResultBody, statusFlow } from "./entry-status-helpers";
import { batch, db, importedRace, okPayload, useRaceDatabase } from "./race-fixtures";

useRaceDatabase();
const { classBlockers, decide, entryId, entryStatus, finalizeAll, revisions } = statusFlow(db);

const boPayload = { ...okPayload, cardNumber: "67890" };

describe("steg 23: ej start i statusflödet (ADR-0173 beslut 1)", () => {
  it("lägger till en revision utan avläsning, exakt en gång och idempotent på begärans id", async () => {
    const { raceId } = await importedRace();
    const auth = await raceAuth(db, raceId);
    const ada = await entryId(raceId, "Ada");
    expect(await entryStatus(auth, ada)).toMatchObject({ headRevision: 0, governingDecision: "NONE",
      readiness: { DID_NOT_START: "READY", DISQUALIFIED: "READY", APPROVE_MANUALLY: "NO_ACTIVE_RESULT", WITHDRAW: "NO_ACTIVE_DECISION" } });
    const requestId = randomUUID();
    const attempts = await Promise.all(Array.from({ length: 50 }, () =>
      decide(auth, ada, { kind: "DID_NOT_START" }, { requestId, expectedRevision: 0 })));
    const receipts = attempts.flatMap((attempt) => attempt.status === "decided" ? [attempt.response] : []);
    expect(receipts).toHaveLength(50);
    expect(new Set(receipts.map((receipt) => receipt.resultRevisionId)).size).toBe(1);
    expect(receipts.filter((receipt) => !receipt.replayed)).toHaveLength(1);

    const history = await revisions(ada);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ revision: 1, cause: "MANUAL_DID_NOT_START", status: "DNS", reason: "DID_NOT_START",
      readoutId: null, requestId, published: true });
    expect(history[0]?.evaluation).toMatchObject({ status: "DNS", reason: "DID_NOT_START", entryId: ada });
    expect(await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)))
      .toEqual([expect.objectContaining({ action: "DID_NOT_START_DECIDED", entityId: history[0]!.id })]);
    expect(await db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId))).toHaveLength(0);
    await expect(db.update(schema.resultRevisions).set({ status: "OK" }).where(eq(schema.resultRevisions.id, history[0]!.id)))
      .rejects.toThrow();

    // Samma begäran med ett annat beslut, ett nytt ej start och ett gammalt underlag avvisas.
    expect(await decide(auth, ada, { kind: "WITHDRAW" }, { requestId, expectedRevision: 0 })).toMatchObject({ status: "conflict" });
    expect(await decide(auth, ada, { kind: "DID_NOT_START" })).toMatchObject({ status: "conflict", readiness: "HAS_RESULT" });
    expect(await decide(auth, ada, { kind: "DID_NOT_START" }, { expectedRevision: 0 }))
      .toMatchObject({ status: "conflict", headRevision: 1, readiness: "STALE_RESULT" });
    await ingestDeviceBatch(db, raceId, batch(randomUUID(), boPayload));
    expect(await decide(auth, await entryId(raceId, "Bo"), { kind: "DID_NOT_START" }))
      .toMatchObject({ status: "conflict", readiness: "HAS_RESULT" });
    expect(await revisions(ada)).toHaveLength(1);
  });

  it("serialiserar samtidig avläsning och ej start till ett helt före- eller efterläge", async () => {
    const { raceId } = await importedRace();
    const auth = await raceAuth(db, raceId);
    const ada = await entryId(raceId, "Ada");
    const [ingested, decided] = await Promise.all([ingestDeviceBatch(db, raceId, batch(randomUUID(), okPayload)),
      decide(auth, ada, { kind: "DID_NOT_START" }, { expectedRevision: 0 })]);
    expect(ingested.acknowledgements[0]?.status).toBe("stored");
    const history = await revisions(ada);
    if (decided.status === "decided") {
      expect(history.map((row) => row.cause)).toEqual(["MANUAL_DID_NOT_START", "CARD_READOUT"]);
    } else {
      expect(decided).toMatchObject({ status: "conflict" });
      expect(history.map((row) => row.cause)).toEqual(["CARD_READOUT"]);
    }
    expect(history.map((row) => row.revision)).toEqual(history.map((_, index) => index + 1));
  });

  it("fastställer ej start som status-only och behåller det frysta när ej start tas bort", async () => {
    const { raceId } = await importedRace();
    const auth = await raceAuth(db, raceId);
    const ada = await entryId(raceId, "Ada");
    await ingestDeviceBatch(db, raceId, batch(randomUUID(), boPayload));
    expect((await decide(auth, ada, { kind: "DID_NOT_START" })).status).toBe("decided");
    const finalizationId = await finalizeAll(auth);
    const [frozen] = await db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.id, finalizationId));
    if (!frozen?.completeXml) throw new Error("Fryst Complete saknas");
    const dns = personResultBody(frozen.completeXml, "Ada");
    expect(dns).toContain("<Status>DidNotStart</Status>");
    expect(dns).not.toMatch(/<(StartTime|FinishTime|Time|Position|SplitTime)(?:\s|>)/);
    expect(JSON.stringify(frozen.frozenProjection)).toContain('"cause":"MANUAL_DID_NOT_START"');

    const withdrawn = await decide(auth, ada, { kind: "WITHDRAW" });
    expect(withdrawn).toMatchObject({ status: "decided", response: { revision: 2, cause: "MANUAL_DID_NOT_START_WITHDRAWAL" } });
    const [after] = await db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.id, finalizationId));
    expect(after?.completeXml).toBe(frozen.completeXml);
    expect(await classBlockers(auth)).toContain("WITHDRAWN_DID_NOT_START");
  });

  it("döljer löparen när ej start tas bort och visar en senare avläsning", async () => {
    const { raceId } = await importedRace();
    const auth = await raceAuth(db, raceId);
    const ada = await entryId(raceId, "Ada");
    await decide(auth, ada, { kind: "DID_NOT_START" });
    expect((await publicResults(db, raceId)).results.find((row) => row.givenName === "Ada")).toMatchObject({ status: "DNS" });
    expect(await entryStatus(auth, ada)).toMatchObject({ governingDecision: "DNS", readiness: { WITHDRAW: "READY" },
      withdrawRestores: null });
    expect((await decide(auth, ada, { kind: "WITHDRAW" })).status).toBe("decided");
    expect((await publicResults(db, raceId)).results.find((row) => row.givenName === "Ada")).toBeUndefined();
    expect(await getAdministratorEffectiveResult(db, { ...auth, entryId: ada })).toMatchObject({ status: "ok",
      response: { state: "NO_ACTIVE_RESULT", selectedRevision: { revision: 2 } } });
    expect(await entryStatus(auth, ada)).toMatchObject({ governingDecision: "NONE", noActiveResult: true,
      readiness: { DID_NOT_START: "READY", WITHDRAW: "NO_ACTIVE_DECISION" } });
    expect(await decide(auth, ada, { kind: "WITHDRAW" })).toMatchObject({ status: "conflict", readiness: "NO_ACTIVE_DECISION" });

    await ingestDeviceBatch(db, raceId, batch(randomUUID(), okPayload));
    expect((await publicResults(db, raceId)).results.find((row) => row.givenName === "Ada"))
      .toMatchObject({ revision: 3, status: "OK" });
  });

  it("nekar funktionären och en skrivning utan CSRF utan att skriva något", async () => {
    const { raceId } = await importedRace();
    const admin = await raceAuth(db, raceId);
    const functionary = await raceAuth(db, raceId, "FUNCTIONARY");
    const ada = await entryId(raceId, "Ada");
    expect(await decide(functionary, ada, { kind: "DID_NOT_START" }, { expectedRevision: 0 })).toEqual({ status: "forbidden" });
    expect(await decide({ ...admin, csrfHeader: "x".repeat(43) }, ada, { kind: "DID_NOT_START" }, { expectedRevision: 0 }))
      .toEqual({ status: "forbidden" });
    expect(await revisions(ada)).toHaveLength(0);
  });
});
