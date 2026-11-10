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
    expect(html).toContain("1:00:00");
    expect(html).not.toMatch(/entryId|resultRevisionId|sourceHash|completeXml|decisionId|split/i);
  });

  it("visas på engelska för en besökare med engelska (översynen 2026-11-10, E)", () => {
    const html = renderToStaticMarkup(<PublicFrozenRaceResults language="en" result={{
      formatVersion: 1,
      eventName: "Archipelago weekend",
      finalizedAt: "2026-09-21T14:30:00.000Z",
      results: [{ className: "H21", givenName: "Ada", familyName: "Runner", organisationName: "Central OK", status: "MP", elapsedMs: null, position: null, timeBehindMs: null }]
    }} />);
    expect(html).toContain("Official final results");
    expect(html).toContain("Mispunch");
    expect(html).toMatch(/Finalised 21 Sep/);
    expect(html).not.toContain("Fastställda");
    expect(html).not.toContain("Felstämplad");
  });
});
