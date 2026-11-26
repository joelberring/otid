import { describe, expect, it } from "vitest";
import { guestMayUse } from "./guest-demo-limits";

/** Demoläget (ADR-0220, tillägg 2026-11-16): gästen provar men skriver inte ut, laddar inte ner och når inte Eventor. */
describe("demoläget: det gästen inte får", () => {
  it("utskrift, nedladdning, uppladdning och tjänster utanför O-Tid är stängda", () => {
    for (const [kind, method] of [["race-export", "GET"], ["result-export", "GET"], ["start-list-export", "GET"], ["map-print", "POST"],
      ["course-setting-print-jobs", "POST"], ["course-setting-print-job-pdf", "GET"], ["course-setting-original", "GET"],
      ["course-setting-import", "POST"], ["race-map", "PUT"], ["race-map-source", "POST"], ["race-map-source", "PATCH"], ["eventor", "GET"], ["runner-search", "POST"],
      ["radio-fetch", "POST"]] as const) {
      expect(guestMayUse(kind, method), `${kind} ${method}`).toBe(false);
    }
  });

  it("att lägga banor, anmäla, läsa av och se kartan går", () => {
    for (const [kind, method] of [["course-setting", "PUT"], ["course-setting", "GET"], ["course-setting-print-jobs", "GET"],
      ["race-map", "GET"], ["race-map-image", "GET"], ["race-map-source", "GET"], ["registration", "POST"], ["readout-registrations", "POST"],
      ["course-setting-transfer", "POST"], ["remaining-runners", "GET"]] as const) {
      expect(guestMayUse(kind, method), `${kind} ${method}`).toBe(true);
    }
  });
});
