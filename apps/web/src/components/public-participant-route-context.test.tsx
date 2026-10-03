import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PublicParticipantRouteContext } from "./public-participant-route-context";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("TASK126 public participant route context", () => {
  it("renders only existing public participant and race context", () => {
    const html = renderToStaticMarkup(<PublicParticipantRouteContext eventName="Skärgårdshelgen" raceName="Lång" raceDate="2026-08-20" givenName="Ada" familyName="Lovelace" className="D21" />);
    expect(html).toContain("Skärgårdshelgen");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("Lång · 2026-08-20");
    expect(html).toContain("Klass: D21");
    expect(html).not.toMatch(/organisation|position|status|sträcka|entryId|storeId|objectKey|versionId|sourceHash|latitude|longitude/i);
  });

  it("keeps the public result lookup and existing route failure path separate", () => {
    const page = source("../app/results/[raceId]/participants/[publicResultId]/route/page.tsx");
    const css = source("../app/globals.css");
    expect(page).toContain("publicResultDetail(db, raceId, publicResultId)");
    expect(page).toContain('if (detail.status === "not-found") notFound();');
    expect(page).toContain("<PublicParticipantRoute raceId={raceId} publicResultId={publicResultId} />");
    expect(css).toContain(".public-participant-route-context :is(h1, p) { margin: 0; overflow-wrap: anywhere; }");
  });
});
