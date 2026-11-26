import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicRelayResults, PublicResultListResponse } from "@o-tid/contracts";
import { SplitAnalysis } from "./split-analysis";
import { PUBLIC_PAGE_INLINE_ROWS, publicPageRows } from "../../lib/public-race-cache";

const raceId = "10000000-0000-4000-8000-000000000001";
const runnerId = "10000000-0000-4000-8000-000000000010";
const emptyRelay: PublicRelayResults = { formatVersion: 1, classes: [] };

describe("SplitAnalysis och SSR-gräns (PUBLIC_PAGE_INLINE_ROWS)", () => {
  it("visar laddningsläge utan initial data när tävlingen överstiger PUBLIC_PAGE_INLINE_ROWS", () => {
    const many = { results: Array.from({ length: PUBLIC_PAGE_INLINE_ROWS + 1 }, () => ({})) };
    expect(publicPageRows(many, emptyRelay)).toBeGreaterThan(PUBLIC_PAGE_INLINE_ROWS);
    const html = renderToStaticMarkup(<SplitAnalysis raceId={raceId} initial={undefined} routeLegs={{}} initialClass="H21" />);
    expect(html).toContain('role="status"');
  });

  it("ritar sträcktidsanalysen direkt när initial data ryms inom SSR-gränsen", () => {
    const results: PublicResultListResponse = {
      formatVersion: 7,
      results: [{
        className: "H21", givenName: "Ada", familyName: "Ek", organisationName: "Centrum OK",
        publicResultId: runnerId, revision: 1, status: "OK", reason: "COMPLETE", elapsedMs: 600_000,
        splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 300_000, legMs: 300_000 }],
        missingControls: [], extraPunches: [], rankingState: "RANKED", position: 1, timeBehindMs: 0
      }]
    };
    expect(publicPageRows(results, emptyRelay)).toBeLessThanOrEqual(PUBLIC_PAGE_INLINE_ROWS);
    const html = renderToStaticMarkup(
      <SplitAnalysis raceId={raceId} initial={{ results, relay: emptyRelay }} routeLegs={{}} initialClass="H21" />
    );
    expect(html).toContain("Ada Ek");
    expect(html).toContain("H21");
  });
});
