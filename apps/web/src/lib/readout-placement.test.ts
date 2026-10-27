import { afterEach, describe, expect, it } from "vitest";
import type { PlacementSubject } from "@o-tid/application";
import type { DeviceBatchAcknowledgement, PublicResultListResponse } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import type { CachedPublic } from "./public-race-cache";
import { clearPlacementResults, withPlacements } from "./readout-placement";

const race = "00000000-0000-4000-8000-0000000000aa";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = "a".repeat(64);

/** En kvittens för avläsningen `n` med resultatrevisionen id(100 + n). */
function ack(n: number, status: "stored" | "duplicate" = "stored"): DeviceBatchAcknowledgement {
  return { deviceId: id(900), highestContiguousSequence: n, currentPackageVersion: 1, packageVersionStatus: "current",
    packageUpdateRequired: false, acknowledgements: [{ localSequence: n, contentHash: hash, status, rawMessageId: id(200 + n),
      serverResult: { status: "OK", reason: "COMPLETE", resultRevisionId: id(100 + n), revision: 1, courseVersionId: id(300),
        engineVersion: "test", snapshotVersion: 1, evaluationHash: hash } }] };
}

const subject = (n: number, elapsedMs: number): PlacementSubject => ({ resultRevisionId: id(100 + n), publicResultId: id(n),
  className: "H21", name: `Löpare ${n}`, status: "OK", elapsedMs, relay: false });

/** En räknad lista med löparna (namn, tid) som började räknas `startedAt`. */
function list(rows: [number, number][], startedAt: number): CachedPublic<PublicResultListResponse> {
  const value = { formatVersion: 7, results: rows.map(([n, elapsedMs]) => ({ className: "H21", publicResultId: id(n), givenName: "Löpare",
    familyName: String(n), status: "OK", elapsedMs, rankingState: "RANKED" })) } as unknown as PublicResultListResponse;
  return { key: "v", at: startedAt + 1, startedAt, value, json: "", gzip: Buffer.from(""), etag: "" };
}

const db = {} as Database;

describe("placeringen till avläsningens kvitto (steg 57)", () => {
  afterEach(() => clearPlacementResults());

  it("räknas ur den cachade listan med de avläsningar som kommit in sedan den räknades", async () => {
    const subjects = new Map([[id(101), subject(1, 1_900_000)], [id(102), subject(2, 1_850_000)]]);
    const loadSubjects = async (_db: Database, _race: string, ids: readonly string[]) =>
      new Map(ids.map((revision) => [revision, subjects.get(revision)!]));
    // Listan räknades kl 1 000 med en löpare (3); löpare 1 och 2 läses av efter det, på två olika datorer.
    const cached = list([[3, 1_800_000]], 1_000);
    const lists = { results: async () => cached, relay: async () => undefined };
    const first = await withPlacements(db, race, ack(1), lists, { now: () => 2_000, loadSubjects });
    expect(first.acknowledgements[0]).toMatchObject({ placement: { kind: "individual",
      standing: { position: 2, finished: 2, leader: { name: "Löpare 3", behindMs: 100_000 } } } });
    const second = await withPlacements(db, race, ack(2), lists, { now: () => 3_000, loadSubjects });
    expect(second.acknowledgements[0]).toMatchObject({ placement: { kind: "individual",
      standing: { position: 2, tied: false, finished: 3, leader: { name: "Löpare 3", behindMs: 50_000 } } } });
  });

  it("ger ingen placering när ingen lista finns och utan godkänt resultat", async () => {
    const loadSubjects = async () => new Map([[id(101), subject(1, 1_900_000)]]);
    const none = await withPlacements(db, race, ack(1), { results: async () => undefined, relay: async () => undefined }, { loadSubjects });
    expect(none.acknowledgements[0]).not.toHaveProperty("placement");
    const mp = await withPlacements(db, race, ack(1), { results: async () => list([], 0), relay: async () => undefined },
      { loadSubjects: async () => new Map([[id(101), { ...subject(1, 1_900_000), status: "MP" as const }]]) });
    expect(mp.acknowledgements[0]).not.toHaveProperty("placement");
  });

  it("ett fel i placeringen ger kvittot utan placering", async () => {
    const failing = await withPlacements(db, race, ack(1), { results: async () => { throw new Error("nere"); }, relay: async () => undefined },
      { loadSubjects: async () => new Map([[id(101), subject(1, 1_900_000)]]) });
    expect(failing).toEqual(ack(1));
  });
});
