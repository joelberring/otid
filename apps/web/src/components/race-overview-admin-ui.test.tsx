import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RaceOverviewAdmin } from "./race-overview-admin";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("TASK 005J race overview UI", () => {
  it("serverrenderar bara svenskt login-skal och lopp-id före auth", () => {
    const html = renderToStaticMarkup(<RaceOverviewAdmin raceId="10000000-0000-4000-8000-000000000001" />);
    expect(html).toContain("Skyddad tävlingsöversikt");
    expect(html).toContain("10000000-0000-4000-8000-000000000001");
    expect(html).toContain('type="password"');
    expect(html).toContain("Ingen data visas");
    expect(html).not.toMatch(/Stationssimulator|Bricknummer|Avläsningar|Resultatrevisioner/);
  });

  it("adminsidans RSC varken läser, renderar eller monterar privat data och simulator", () => {
    const page = source("../app/admin/[raceId]/page.tsx");
    expect(page).toContain("<RaceOverviewAdmin raceId={raceId}");
    expect(page).not.toMatch(/raceOverview\(|publicRaceSummary|from "@o-tid\/application"|from "\.\.\/\.\.\/\.\.\/lib\/db"/);
    expect(page).not.toMatch(/Simulator|entries|readouts|revisions|imports/);
  });

  it("håller credential och DTO i React-minne utan polling, timer eller Web Storage", () => {
    const component = source("./race-overview-admin.tsx");
    expect(component).toContain('useState<RaceOverviewResponse>()');
    expect(component).toContain('useState("")');
    expect(component).not.toMatch(/localStorage|sessionStorage|indexedDB|setInterval|setTimeout/);
    expect(component).toContain("await loadOverview()");
    expect(component).toContain("onClick={() => void refresh()}");
    expect(component).toContain("setAccessCredential(\"\")");
  });

  it("rensar DTO direkt vid logout och erbjuder endast uttrycklig retry vid okänt utfall", () => {
    const component = source("./race-overview-admin.tsx");
    expect(component.indexOf("setOverview(undefined);", component.indexOf("async function requestLogout")))
      .toBeLessThan(component.indexOf("await fetch(sessionUrl", component.indexOf("async function requestLogout")));
    expect(component).toContain("setLogoutUnconfirmed(true)");
    expect(component).toContain("onClick={() => void requestLogout()}");
    expect(component).not.toContain("void requestLogout();");
  });

  it("visar mutationslänkar endast i den autentiserade DTO-grenen", () => {
    const component = source("./race-overview-admin.tsx");
    const protectedBranch = component.indexOf("authenticated === true && overview");
    for (const surface of ["/pairing", "/imports", "/classes", "/recalculation"]) {
      expect(component.indexOf(surface)).toBeGreaterThan(protectedBranch);
    }
    expect(component).not.toContain("/simulator");
    expect(component.indexOf('href={`/admin/${raceId}/manage`}')).toBeGreaterThan(protectedBranch);
    expect(component).toContain("raceWorkspaceSv.manageLink");
    expect(source("../i18n/race-workspace-sv.ts")).toContain("separat administratörsbehörighet");
  });

  it("publikresultat använder bara den publika rubrikprojektionen", () => {
    const page = source("../app/results/[raceId]/page.tsx");
    expect(page).toContain("publicRaceSummary");
    expect(page).not.toContain("raceOverview");
  });

  it("bevarar simulatorn bakom servergrinden med endast snapshotVersion-projektion", () => {
    const overviewPage = source("../app/admin/[raceId]/page.tsx");
    const simulatorPage = source("../app/admin/[raceId]/simulator/page.tsx");
    const serverGate = source("../lib/simulator-page.server.ts");
    expect(overviewPage).not.toContain("Simulator");
    expect(simulatorPage).toContain("resolveCurrentSimulatorPage(params");
    expect(simulatorPage).toContain("<Simulator raceId={raceId} packageVersion={snapshotVersion}");
    expect(simulatorPage).toContain('"select snapshot_version from race where id = $1"');
    expect(simulatorPage).not.toContain("raceOverview");
    expect(serverGate).toContain('import "server-only"');
    expect(serverGate).toContain('await headers()');
  });

  it("sätter privata säkerhetsheaders även på den exakta overview-sidan", () => {
    const config = source("../../next.config.ts");
    expect(config).toContain('{ source: "/admin/:raceId", headers: [...privateAdminHeaders] }');
    expect(config).toContain('{ key: "Cache-Control", value: "private, no-store" }');
    expect(config).toContain('{ key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" }');
    expect(config).toContain('{ key: "X-Frame-Options", value: "DENY" }');
  });
});
