import { afterEach, describe, expect, it, vi } from "vitest";
import { isDatabaseUnavailable, redactErrorMessage, summarizeServerError } from "./server-error-log";
import { retryTransactionConflicts } from "./read-conflict";
import { raceAdministratorRoute } from "./race-administrator-route-handlers";
import { readoutIngestRoute } from "./readout-station-route-handlers";
import { db, dependencies, environment, id, request } from "./race-administrator-route-test-helpers";

afterEach(() => { vi.restoreAllMocks(); });

function pgError(code: string, message: string) {
  return Object.assign(new Error(message), { code, constraint: "card_assignment_active_race_card_uidx", table: "card_assignment",
    detail: "Key (race_id, card_number)=(…, 2001848) already exists." });
}

describe("serverfel loggas utan personuppgifter (översynen 2026-11-02)", () => {
  it("tvättar värden, behåller felkod, constraint och stack men aldrig PostgreSQL:s detail", () => {
    expect(redactErrorMessage("invalid input syntax for type uuid: \"Anna Andersson\" bricka 2001848 anna@example.com"))
      .toBe("invalid input syntax for type uuid: \"…\" bricka … …@…");
    expect(redactErrorMessage("duplicate key value violates unique constraint \"card_assignment_active_race_card_uidx\""))
      .toContain("\"card_assignment_active_race_card_uidx\"");
    const summary = summarizeServerError("readout", "ingest", new Error("wrapper", { cause: pgError("23505", "duplicate key") }));
    expect(summary).toMatchObject({ area: "readout", action: "ingest", name: "Error", code: "23505",
      constraint: "card_assignment_active_race_card_uidx", table: "card_assignment", message: "wrapper" });
    expect(summary.stack).toMatch(/^at /);
    expect(JSON.stringify(summary)).not.toContain("2001848");
  });

  it("känner igen en databas som inte går att nå", () => {
    expect(isDatabaseUnavailable(Object.assign(new Error("connect"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isDatabaseUnavailable(pgError("57P01", "terminating connection due to administrator command"))).toBe(true);
    expect(isDatabaseUnavailable(pgError("08006", "connection failure"))).toBe(true);
    expect(isDatabaseUnavailable(pgError("23505", "duplicate key"))).toBe(false);
  });

  it("gör om 40P01 och 40001 högst tre gånger med växande väntan", async () => {
    const waits: number[] = [];
    let calls = 0;
    const result = await retryTransactionConflicts(async () => {
      calls += 1;
      if (calls < 3) throw pgError(calls === 1 ? "40P01" : "40001", "deadlock detected");
      return "klart";
    }, async (ms) => { waits.push(ms); });
    expect(result).toBe("klart");
    expect(waits).toHaveLength(2);
    expect(waits[1]!).toBeGreaterThan(waits[0]!);
    calls = 0;
    await expect(retryTransactionConflicts(async () => { calls += 1; throw pgError("40P01", "deadlock"); }, async () => undefined))
      .rejects.toThrow("deadlock");
    expect(calls).toBe(3);
    calls = 0;
    await expect(retryTransactionConflicts(async () => { calls += 1; throw pgError("23505", "dup"); }, async () => undefined)).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("ett 500 från administratörens skrivning loggas med åtgärd och felkod men utan personuppgifter", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const body = { formatVersion: 1, classId: id, expectedCourseVersionId: id, expectedStartRule: "PUNCH",
      givenName: "Ny", familyName: "Testperson", organisationName: null, cardNumber: null, fixedStartTime: null };
    const registration = vi.fn(async () => { throw new Error("Brickan 2001848 saknas", { cause: pgError("23505", "dup") }); });
    const services = { ...dependencies(), registration };
    const req = () => request("POST", JSON.stringify(body), { "idempotency-key": `entry-registration:${id}` });
    expect((await raceAdministratorRoute(db, req(), id, { kind: "registration" }, services, environment)).status).toBe(500);
    const line = String(logged.mock.calls.at(-1)?.[0]);
    expect(line).toContain('"action":"POST registration"');
    expect(line).toContain('"code":"23505"');
    expect(line).not.toContain("2001848");
  });

  it("avläsningen: 40P01 görs om, en databas som inte svarar ger 503 med retry-after", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const payload = { cardNumber: "12345", startPunchedAt: "2026-09-12T10:00:00Z", finishPunchedAt: "2026-09-12T10:20:00Z",
      punches: [{ code: 31, punchedAt: "2026-09-12T10:10:00Z" }] };
    const batch = { deviceId: id, sessionId: id, packageVersion: 1, firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1,
      stationReceivedAt: "2026-09-12T10:21:00Z", transport: "simulator", payload, contentHash: "a".repeat(64) }] };
    const acknowledgement = { deviceId: id, highestContiguousSequence: 0, currentPackageVersion: 1, packageVersionStatus: "current",
      packageUpdateRequired: false, acknowledgements: [{ localSequence: 1, contentHash: "a".repeat(64), status: "stored",
        rawMessageId: id }] };
    let calls = 0;
    const ingest = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw pgError("40P01", "deadlock detected");
      return { status: "ok" as const, response: acknowledgement };
    });
    const services = { authenticate: dependencies().authenticate, ingest, place: async (_db: unknown, _race: string, ack: unknown) => ack };
    const req = () => request("POST", JSON.stringify(batch));
    // @ts-expect-error testets förenklade tjänster
    const ok = await readoutIngestRoute(db, req(), id, services, environment);
    expect(ok.status).toBe(200);
    expect(ingest).toHaveBeenCalledTimes(2);
    ingest.mockImplementation(async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }); });
    // @ts-expect-error testets förenklade tjänster
    const down = await readoutIngestRoute(db, req(), id, services, environment);
    expect(down.status).toBe(503);
    expect(down.headers.get("retry-after")).toBe("5");
    ingest.mockImplementation(async () => { throw new Error("annat fel"); });
    // @ts-expect-error testets förenklade tjänster
    expect((await readoutIngestRoute(db, req(), id, services, environment)).status).toBe(500);
  });
});
