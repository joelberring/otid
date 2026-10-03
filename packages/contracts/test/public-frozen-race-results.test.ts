import { describe, expect, it } from "vitest";
import { publicFrozenRaceResultsResponseSchema } from "../src";

const response = {
  formatVersion: 1 as const,
  eventName: "Skärgårdshelgen lång",
  finalizedAt: "2026-09-21T14:30:00.000Z",
  results: [{
    className: "H21",
    givenName: "Ada",
    familyName: "Löpare",
    organisationName: "Centrum OK",
    status: "OK" as const,
    elapsedMs: 3_600_000,
    position: 1,
    timeBehindMs: 0
  }]
};

describe("publicFrozenRaceResultsResponseSchema", () => {
  it("accepterar en liten, fryst publik resultatrad utan provenance", () => {
    const parsed = publicFrozenRaceResultsResponseSchema.parse(response);
    expect(parsed).toEqual(response);
    expect(JSON.stringify(parsed)).not.toMatch(/entryId|revisionId|classFinalization|sourceHash|completeXml|decisionId/i);
  });

  it.each([
    ["intern identitet", { ...response.results[0], entryId: "11111111-1111-4111-8111-111111111111" }],
    ["halv ranking", { ...response.results[0], position: null }],
    ["orankad status med placering", { ...response.results[0], status: "MP", position: 1, timeBehindMs: 0 }],
    ["DNS med tid", { ...response.results[0], status: "DNS", elapsedMs: 1, position: null, timeBehindMs: null }]
  ])("avvisar %s", (_name, result) => {
    expect(publicFrozenRaceResultsResponseSchema.safeParse({ ...response, results: [result] }).success).toBe(false);
  });
});
