import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReadoutResultHistoryAdmin } from "./readout-result-history-admin";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("TASK 005N history-UI", () => {
  it("serverrenderar endast svenskt privat login-shell före auth", () => {
    const html = renderToStaticMarkup(<ReadoutResultHistoryAdmin raceId="10000000-0000-4000-8000-000000000001" />);
    expect(html).toContain("Skyddade avläsningar och resultathistorik");
    expect(html).toContain('type="password"');
    expect(html).not.toMatch(/Ada Lovelace|12345|MISSING_CONTROL|CARD_READOUT/);
  });
  it("har separat sida, route och privat headergräns", () => {
    expect(source("../app/admin/[raceId]/history/page.tsx")).toContain("<ReadoutResultHistoryAdmin raceId={raceId}");
    expect(source("../../next.config.ts")).toContain('{ source: "/admin/:raceId/history", headers: [...privateAdminHeaders] }');
    expect(source("../components/race-overview-admin.tsx")).toContain("/history");
  });
  it("använder React-minne och explicit paginering utan polling eller Web Storage", () => {
    const component = source("./readout-result-history-admin.tsx");
    expect(component).toContain("loadOlderReadouts");
    expect(component).toContain("readoutHistoryShowOlderRevisions");
    expect(component).not.toMatch(/localStorage|sessionStorage|indexedDB|setInterval|setTimeout|EventSource/);
    expect(component.indexOf("clearPrivateState();", component.indexOf("async function requestLogout")))
      .toBeLessThan(component.indexOf("await fetch(sessionUrl", component.indexOf("async function requestLogout")));
  });
});
