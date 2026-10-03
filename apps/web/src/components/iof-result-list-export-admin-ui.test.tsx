import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IofResultListExportAdmin } from "./iof-result-list-export-admin";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("TASK 006B export-UI", () => {
  it("serverrenderar endast ett svenskt privat login-shell före auth", () => {
    const html = renderToStaticMarkup(<IofResultListExportAdmin raceId="10000000-0000-4000-8000-000000000001" />);
    expect(html).toContain("Skyddad IOF ResultList-export");
    expect(html).toContain('type="password"');
    expect(html).not.toMatch(/Ada Lovelace|12345|CANARY|<ResultList/);
  });

  it("har separat sida, sessionroute, downloadroute och privat headergräns", () => {
    expect(source("../app/admin/[raceId]/exports/page.tsx")).toContain("<IofResultListExportAdmin raceId={raceId}");
    expect(source("../app/api/admin/races/[raceId]/iof-result-list-export-session/route.ts"))
      .toContain("iofResultListExportAdminLoginRoute");
    expect(source("../app/api/admin/races/[raceId]/exports/result-list.xml/route.ts"))
      .toContain("iofResultListExportDownloadRoute");
    expect(source("../../next.config.ts")).toContain('{ source: "/admin/:raceId/exports", headers: [...privateAdminHeaders] }');
    expect(source("./race-overview-admin.tsx")).toContain("/exports");
  });

  it("verifierar hash och använder kortlivad Blob-URL utan secrets eller Web Storage", () => {
    const component = source("./iof-result-list-export-admin.tsx");
    expect(component).toContain('crypto.subtle.digest("SHA-256", buffer)');
    expect(component).toContain("new Blob([buffer]");
    expect(component).toContain("URL.createObjectURL");
    expect(component).toContain("URL.revokeObjectURL(objectUrl)");
    expect(component).not.toMatch(/localStorage|sessionStorage|indexedDB|setInterval|setTimeout|EventSource/);
    expect(component.indexOf("clearPrivateState();", component.indexOf("async function requestLogout")))
      .toBeLessThan(component.indexOf("await fetch(sessionUrl", component.indexOf("async function requestLogout")));
  });
});
