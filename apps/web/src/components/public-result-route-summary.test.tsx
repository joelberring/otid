import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PublicResultRouteSummary } from "./public-result-route-summary";

const route = { formatVersion: 2 as const, imageWidth: 1_000, imageHeight: 500,
  points: [{ x: 100, y: 300, segment: 0 }, { x: 200, y: 200, segment: 0 }],
  controls: [{ sequence: 1, controlCode: 31, x: 120, y: 280 }],
  metadata: { distanceMeters: 1_234, pointCount: 2, segmentCount: 1, timing: { status: "UNAVAILABLE" as const } },
  playback: { status: "UNAVAILABLE" as const },
  notice: "ROUTE_NOT_GPS_VERIFIED" as const };

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("TASK125 public result route summary", () => {
  it("renders only existing public route facts and its exact route link", () => {
    const html = renderToStaticMarkup(<PublicResultRouteSummary route={route} href="/results/race/participants/result/route" />);
    expect(html).toContain("Publik rutt");
    expect(html).toContain("En publik rutt finns för detta resultat.");
    expect(html).toContain("1,23 km");
    expect(html).toContain("2");
    expect(html).toContain("/results/race/participants/result/route");
    expect(html).not.toMatch(/latitude|longitude|entryId|storeId|objectKey|versionId|sourceHash/i);
  });

  it("only mounts the card for an already authorized route and has a compact mobile layout", () => {
    const page = source("../app/results/[raceId]/participants/[publicResultId]/page.tsx");
    const css = source("../app/globals.css");
    expect(page).toContain('{route.status === "ok" && <PublicResultRouteSummary');
    expect(css).toContain(".public-result-route-summary dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }");
  });
});
