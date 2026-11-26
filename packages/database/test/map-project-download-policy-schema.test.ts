import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapProjects } from "../src/schema";

describe("Etapp 2: map_project.source_download_policy schema och migration 0147", () => {
  it("definierar source_download_policy som NOT NULL med default ALLOWED i Drizzle-schemat", () => {
    expect(mapProjects.sourceDownloadPolicy.name).toBe("source_download_policy");
    expect(mapProjects.sourceDownloadPolicy.notNull).toBe(true);
    expect(mapProjects.sourceDownloadPolicy.default).toBe("ALLOWED");
  });

  it("lägger till kolumnen och CHECK-villkoret idempotent i 0147_kartprojekt_sparr.sql", () => {
    const sql = readFileSync(new URL("../migrations/0147_kartprojekt_sparr.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS source_download_policy text NOT NULL DEFAULT 'ALLOWED'/);
    expect(sql).toMatch(/CHECK \(source_download_policy IN \('ALLOWED', 'CUSTODIANS_ONLY'\)\)/);
  });
});
