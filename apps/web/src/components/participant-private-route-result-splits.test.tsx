import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ParticipantPrivateRouteControlTimeSelector, ParticipantPrivateRouteResultSplits } from "./participant-private-route-detail";

describe("TASK163 private route published result splits", () => {
  it("renders published splits separately with revision and provenance caveats", () => {
    const html = renderToStaticMarkup(<ParticipantPrivateRouteResultSplits resultSplits={{
      status: "AVAILABLE",
      resultRevision: 7,
      splits: [{ controlCode: 31, occurrence: 2, legMs: 61_250, elapsedMs: 132_500 }]
    }} />);

    expect(html).toContain("<details>");
    expect(html).toContain("Resultatets publicerade sträcktider");
    expect(html).toContain("Resultatrevision 7");
    expect(html).toContain("Publicerade resultat kan vara preliminära");
    expect(html).toContain("GPS-markören visar inte verifierade kontrollpassager");
    expect(html).toContain("31 (2)");
    expect(html).toContain("1:01.250");
    expect(html).toContain("2:12.500");
  });

  it("shows an explicit missing result split state", () => {
    const html = renderToStaticMarkup(<ParticipantPrivateRouteResultSplits resultSplits={{ status: "UNAVAILABLE" }} />);

    expect(html).toContain("role=\"status\"");
    expect(html).toContain("Publicerade sträcktider saknas just nu.");
    expect(html).not.toContain("GPX");
  });

  it("offers one compact selector with control occurrence and accumulated result time", () => {
    const html = renderToStaticMarkup(<ParticipantPrivateRouteControlTimeSelector
      splits={[
        { controlCode: 31, occurrence: 1, legMs: 600_000, elapsedMs: 600_000 },
        { controlCode: 31, occurrence: 2, legMs: 61_250, elapsedMs: 661_250 }
      ]}
      selectedKey=""
      disabled={false}
      jumpDisabled
      status=""
      onSelect={() => undefined}
      onJump={() => undefined}
    />);

    expect(html).toContain("data-testid=\"private-route-control-time-select\"");
    expect(html).toContain("Resultatets kontrolltid");
    expect(html).toContain("Kontroll 31 · 10:00");
    expect(html).toContain("Kontroll 31 (2) · 11:01.250");
    expect(html).toContain("data-testid=\"private-route-control-time-jump\"");
    expect(html).toContain("Visar motsvarande tidpunkt enligt resultatets ackumulerade kontrolltid.");
    expect(html).toContain("GPS-markören visar inte en verifierad kontrollpassage.");
  });
});
