import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function asset(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("station web assets", () => {
  it("contains critical Swedish status in text and large operative controls", () => {
    const html = asset("../www/index.html");
    const css = asset("../www/station.css");
    const ui = asset("../ui/main.ts");
    expect(html).toContain("Internet");
    expect(html).toContain("Serverkontakt");
    expect(html).toContain("Stationsautentisering");
    expect(html).toContain("SPORTident/USB inte aktiverat");
    expect(html).toContain("Väntar lokalt");
    expect(html).toContain("Synka nu");
    expect(ui).toContain("Servern gäller");
    expect(html).toContain("app.js");
    expect(css).toContain("min-height: 4rem");
  });

  it("persists neither credential nor trust material in browser storage", () => {
    const html = asset("../www/index.html");
    const ui = asset("../ui/main.ts");
    expect(ui).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(html).not.toContain("credential-json");
    expect(html).not.toContain("Stationscredential (JSON)");
    expect(ui).not.toContain("installDeviceCredential");
    expect(ui).toContain('grantInput.value = ""');
    expect(ui).toContain("OtidStationStore.saveBaseUrl");
    expect(ui).not.toMatch(/saveBaseUrl\([^)]*(token|spki)/i);
    expect(ui).not.toContain("authorization:");
  });

  it("requires an explicit operator action to redeem or discard a persisted attempt", () => {
    const html = asset("../www/index.html");
    const ui = asset("../ui/main.ts");
    expect(html).toContain("Återuppta och lös in");
    expect(html).toContain("Kasta väntande försök");
    expect(html).toContain("Rensa oläsbar parning");
    expect(ui).toContain('requiredElement<HTMLButtonElement>("pairing-resume-button").addEventListener("click"');
    expect(ui).toContain("await redeemStationPairing(attemptId)");
    expect(ui).toMatch(/beginStationPairing[\s\S]{0,800}navigator\.onLine[\s\S]{0,300}redeemStationPairing\(pairing\.attempt\.attemptId\)/);
    expect(ui).toContain("window.confirm");
    expect(ui).not.toMatch(/loadBaseUrl[\s\S]{0,800}redeemStationPairing/);
  });

  it("ships a browser bundle without application or Node runtime imports", () => {
    const bundle = asset("../www/app.js");
    expect(bundle.length).toBeGreaterThan(1_000);
    expect(bundle).not.toContain("@o-tid/application");
    expect(bundle).not.toContain("node:crypto");
    expect(bundle).toContain("OtidStationStore");
  });
});
