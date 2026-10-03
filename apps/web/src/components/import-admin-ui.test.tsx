import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("TASK 005G importadmin-UI", () => {


  it("behåller försök vid fel och rensar endast efter validerad bekräftelse eller explicit knapp", () => {
    const component = source("./import-admin.tsx");
    expect(component).toContain("setAttempt(created)");
    expect(component).toContain("parseIofImportResponse");
    expect(component).toContain("clearAttempt();");
    expect(component).toContain("submitAttempt(attempt)");
    expect(component).toContain("setAuthenticated(false)");
    expect(component).not.toMatch(/setTimeout|setInterval/);
  });

  it("visar StartList-delta och kräver uttrycklig resultatomräkning", () => {
    const component = source("./import-admin.tsx");
    const translations = source("../i18n/sv.ts");
    expect(component).toContain('result.report.kind === "EntryList"');
    expect(component).toContain("sv.importStartListSummary(");
    expect(translations).toContain("Inga resultat räknades om automatiskt");
    expect(translations).toContain("resultat behöver uttrycklig omräkning");
    expect(translations).toContain("tävlingsversionen ${snapshotChanged ? \"uppdaterades\" : \"var oförändrad\"}");
  });


  it("lägger privata browserheaders på adminytor och avläsningsskalet", async () => {
    const headers = await (await import("../../next.config")).default.headers!();
    const forSource = (path: string) => new Map(headers.find((rule) => rule.source === path)?.headers.map((h) => [h.key, h.value]));
    for (const path of ["/admin/:raceId/imports", "/admin/:raceId/manage"]) {
      expect(forSource(path).get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
      expect(forSource(path).get("X-Frame-Options")).toBe("DENY");
      expect(forSource(path).get("Cache-Control")).toBe("private, no-store");
    }
    const readout = forSource("/readout/:path*");
    expect(readout.get("Permissions-Policy")).toContain("serial=(self)");
    expect(readout.get("Content-Security-Policy")).toContain("connect-src 'self'");
  });
});
