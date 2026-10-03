import { describe, expect, it } from "vitest";
import type { PublicResultListResponse } from "@o-tid/contracts";
import { filterPublicResults, normalizePublicResultSearch, publicResultClassNames } from "./public-results-filter";

type PublicResultRow = PublicResultListResponse["results"][number];

const rows: readonly PublicResultRow[] = [
  { className: "H21", givenName: "Åke", familyName: "Öberg", organisationName: null, revision: 1, status: "OK", reason: "COMPLETE", elapsedMs: 1_000, splits: [], missingControls: [], extraPunches: [], rankingState: "RANKED", position: 1, timeBehindMs: 0 },
  { className: "D21", givenName: "Ada", familyName: "Löpare", organisationName: null, revision: 1, status: "OK", reason: "COMPLETE", elapsedMs: 2_000, splits: [], missingControls: [], extraPunches: [], rankingState: "RANKED", position: 2, timeBehindMs: 1_000 },
  { className: "Öppen", givenName: "Bo", familyName: "Skog", organisationName: null, revision: 1, status: "MP", reason: "MISSING_CONTROL", elapsedMs: 3_000, splits: [], missingControls: [31], extraPunches: [], rankingState: "NOT_RANKABLE_STATUS" }
];

describe("publik resultatfiltrering", () => {
  it("normaliserar svenska diakritiska tecken och matchar namn eller klass", () => {
    expect(normalizePublicResultSearch(" ÅKE Ö ")).toBe("ake o");
    expect(filterPublicResults(rows, "ake", "").map((row) => row.givenName)).toEqual(["Åke"]);
    expect(filterPublicResults(rows, "oppen", "").map((row) => row.className)).toEqual(["Öppen"]);
  });

  it("kombinerar klass och sökning samt återställer med tomma filter", () => {
    expect(filterPublicResults(rows, "löpare", "D21").map((row) => row.givenName)).toEqual(["Ada"]);
    expect(filterPublicResults(rows, "löpare", "H21")).toEqual([]);
    expect(filterPublicResults(rows, "", "")).toHaveLength(3);
    expect(publicResultClassNames(rows)).toEqual(["D21", "H21", "Öppen"]);
  });
});
