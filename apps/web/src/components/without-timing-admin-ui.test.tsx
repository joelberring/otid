import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WithoutTimingAdmin } from "./without-timing-admin";

function source(relativePath: string): string { return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8"); }

describe("TASK 006M utan-tidtagning-UI", () => {
  it("serverrenderar login-skal utan resultatsfakta", () => {
    const html = renderToStaticMarkup(<WithoutTimingAdmin raceId="10000000-0000-4000-8000-000000000001" />);
    expect(html).toContain("Logga in för beslut utan tidtagning");
    expect(html).toContain('type="password"');
    expect(html).not.toMatch(/Ada Löpare|elapsed/);
  });
  it("kräver bekräftelsesteg och explicit same-id retry i minnet", () => {
    const component = source("./without-timing-admin.tsx");
    expect(component).toContain('setAttemptPhase("CONFIRM")');
    expect(component).toContain('attemptPhase === "CONFIRM"');
    expect(component).toContain('setAttemptPhase("UNKNOWN")');
    expect(component).toContain("without-timing:${current.requestId}");
    expect(component).not.toMatch(/localStorage|sessionStorage|indexedDB|setTimeout|setInterval/);
  });
  it("håller capability, cookie, route och touchyta separat", () => {
    expect(source("../lib/without-timing-admin-route-handlers.ts")).toContain('capability: "DECIDE_WITHOUT_TIMING"');
    expect(source("../lib/without-timing-admin-cookies.ts")).toContain("__Host-otid-without-timing-admin-session");
    expect(source("../app/admin/[raceId]/without-timing/page.tsx")).toContain("<WithoutTimingAdmin");
    expect(source("../../next.config.ts")).toContain("/admin/:raceId/without-timing");
    expect(source("../app/globals.css")).toContain(".without-timing-admin button");
  });
});
