import { describe, expect, it, vi } from "vitest";
import { readoutGeneration } from "./race-change-generation";
import { readoutIngestRoute, readoutPackageRoute } from "./readout-station-route-handlers";
import { db, dependencies, environment, id, other, request } from "./race-administrator-route-test-helpers";

describe("readout-station-route-handlers: enkel behörighetskontroll", () => {
  it("skickar med verifierad principal till readPackage och ingest utan dubbel authenticate", async () => {
    const base = dependencies();
    const pkg = {
      formatVersion: 1 as const, raceId: id, packageVersion: 1, resultEngineVersion: "1",
      event: { id, name: "Event", startsOn: "2026-10-08", timeZone: "Europe/Stockholm" },
      raceSnapshot: { race: { id, eventId: id, name: "Lopp", raceDate: "2026-10-08", snapshotVersion: 1 }, classes: [], courses: [], entries: [], cardAssignments: [] },
      publicLinks: { shortCode: "234567", published: false, participants: [] },
      readOutEntryIds: [], massStarts: [], fetchedAt: "2026-10-08T10:00:00.000Z"
    };
    const readPackage = vi.fn<typeof import("@o-tid/application").readReadoutPackageAsAdmin>(async () => ({ status: "ok" as const, response: pkg }));
    const resPkg = await readoutPackageRoute(db, request("GET"), id, { authenticate: base.authenticate, readPackage }, environment);
    expect(resPkg.status).toBe(200);
    expect(base.authenticate).toHaveBeenCalledTimes(1);
    expect(readPackage).toHaveBeenCalledTimes(1);
    const [pkgDb, pkgInput] = readPackage.mock.calls[0]!;
    expect(pkgDb).toBe(db);
    expect(pkgInput.raceId).toBe(id);
    expect(pkgInput.authorized?.raceId).toBe(id);

    const payload = { cardNumber: "12345", startPunchedAt: "2026-09-12T10:00:00Z", finishPunchedAt: "2026-09-12T10:20:00Z",
      punches: [{ code: 31, punchedAt: "2026-09-12T10:10:00Z" }] };
    const batch = { deviceId: id, sessionId: id, packageVersion: 1, firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1,
      stationReceivedAt: "2026-09-12T10:21:00Z", transport: "simulator", payload, contentHash: "a".repeat(64) }] };
    const acknowledgement = { deviceId: id, highestContiguousSequence: 1, currentPackageVersion: 1, packageVersionStatus: "current" as const,
      packageUpdateRequired: false, acknowledgements: [{ localSequence: 1, contentHash: "a".repeat(64), status: "stored" as const, rawMessageId: id }] };
    const ingest = vi.fn<typeof import("@o-tid/application").ingestReadoutsAsAdmin>(async () => ({ status: "ok" as const, response: acknowledgement }));
    base.authenticate.mockClear();
    const beforeReadoutGen = readoutGeneration(id);
    const resIngest = await readoutIngestRoute(db, request("POST", JSON.stringify(batch)), id,
      { authenticate: base.authenticate, ingest, place: async (_db, _race, ack) => ack }, environment);
    expect(resIngest.status).toBe(200);
    expect(readoutGeneration(id)).toBe(beforeReadoutGen + 1);
    expect(base.authenticate).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledTimes(1);
    const [ingestDb, ingestInput] = ingest.mock.calls[0]!;
    expect(ingestDb).toBe(db);
    expect(ingestInput.raceId).toBe(id);
    expect(ingestInput.authorized?.raceId).toBe(id);

    // En avvisad batch ska inte räkna upp avläsningsgenerationen.
    const rejectedAck = { ...acknowledgement, acknowledgements: [{ localSequence: 1, contentHash: "a".repeat(64),
      status: "rejected" as const, reason: "CONTENT_HASH_MISMATCH" as const }] };
    const ingestRejected = vi.fn<typeof import("@o-tid/application").ingestReadoutsAsAdmin>(async () => ({ status: "ok" as const, response: rejectedAck }));
    const resRejected = await readoutIngestRoute(db, request("POST", JSON.stringify(batch)), id,
      { authenticate: base.authenticate, ingest: ingestRejected, place: async (_db, _race, ack) => ack }, environment);
    expect(resRejected.status).toBe(200);
    expect(readoutGeneration(id)).toBe(beforeReadoutGen + 1);
  });

  it("nekar om principal gäller en annan tävling", async () => {
    const authenticate = vi.fn<typeof import("@o-tid/application").requireRaceRole>().mockResolvedValue({
      status: "authenticated",
      principal: { accountId: id, sessionId: id, raceId: other, eventId: id, grantId: id, grantRole: "OWNER", role: "ADMIN", expiresAt: "2026-09-12T13:00:00Z" }
    });
    const readPackage = vi.fn();
    const res = await readoutPackageRoute(db, request("GET"), id, { authenticate, readPackage }, environment);
    expect(res.status).toBe(403);
    expect(readPackage).not.toHaveBeenCalled();
  });
});
