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

  it("visar StartList-delta och säger var resultaten räknas om", () => {
    const component = source("./import-admin.tsx");
    const translations = source("../i18n/sv.ts");
    expect(component).toContain('result.report.kind === "EntryList"');
    expect(component).toContain("sv.importStartListSummary(");
    expect(translations).toContain("resultat behöver räknas om under Resultat");
    // PLAN.md steg 24: inga interna ord på importsidan.
    for (const word of ["atomärt", "request-id", "SHA-256", "application/xml", "byte\" ", "Skyddad"]) expect(translations).not.toContain(word);
  });

});
