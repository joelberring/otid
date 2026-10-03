import { describe, expect, it } from "vitest";
import type { PublicResultListResponseV7 } from "@o-tid/contracts";
import { publicClassLeaders } from "./race-workspace-speaker-leaders";

const common = {
  publicResultId: "e9b2bb2d-1af7-4bf2-8e36-21c32f02a537",
  className: "D21",
  givenName: "Ada",
  familyName: "Löpare",
  organisationName: null,
  revision: 1,
  reason: "COMPLETE" as const,
  elapsedMs: 61_000,
  splits: [],
  missingControls: [],
  extraPunches: []
};

describe("TASK216 publik klassledarhärledning", () => {
  it("visar alla delade verifierade ettor men ingen annan publik rad", () => {
    const response: PublicResultListResponseV7 = { formatVersion: 7, results: [
      { ...common, status: "OK", rankingState: "RANKED", position: 1, timeBehindMs: 0 },
      { ...common, publicResultId: "b1a434b5-7d8c-4959-af7f-dbc5897fda3a", givenName: "Bo", status: "OK", rankingState: "RANKED", position: 1, timeBehindMs: 0 },
      { ...common, publicResultId: "2bfb4901-29cb-49ad-9cba-3d742915e523", className: "H21", position: 2, timeBehindMs: 5_000, status: "OK", rankingState: "RANKED" },
      { ...common, publicResultId: "b5746706-0127-4e57-850c-7f55bd06067a", status: "OK", rankingState: "MIXED_COURSE_VERSIONS" }
    ] };

    expect(publicClassLeaders(response).map((row) => row.givenName)).toEqual(["Ada", "Bo"]);
  });
});
