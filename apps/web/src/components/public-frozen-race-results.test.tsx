import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";
import { PublicFrozenRaceResults } from "./public-frozen-race-results";

describe("PublicFrozenRaceResults", () => {
  it("visar bara den lilla frysta publika projektionen", () => {
    const html = renderToStaticMarkup(<PublicFrozenRaceResults result={{
      formatVersion: 1,
      eventName: "Skärgårdshelgen lång",
      finalizedAt: "2026-09-21T14:30:00.000Z",
      results: [{ className: "H21", givenName: "Ada", familyName: "Löpare", organisationName: "Centrum OK", status: "OK", elapsedMs: 3_600_000, position: 1, timeBehindMs: 0 }]
    }} />);
    expect(html).toContain("Fastställda slutresultat");
    expect(html).toContain("Ada Löpare");
    expect(html).toContain("60:00");
    expect(html).not.toMatch(/entryId|resultRevisionId|sourceHash|completeXml|decisionId|split/i);
  });
});
