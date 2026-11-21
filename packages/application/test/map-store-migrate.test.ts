import { describe, expect, it } from "vitest";
import { categoryOf, orderMigrateCandidates, type MigrateCandidate } from "../src/map-store-migrate";
import { inMigrateWindow, migrateSettings, migrateSettingsProblems, stockholmHour } from "../src/map-store-migrate-settings";

/** PLAN.md steg M3: flyttens urval, ordning, fönster och inställningar. */
const MB = 1024 * 1024;
const candidate = (sha: string, category: MigrateCandidate["category"], mb: number): MigrateCandidate =>
  ({ sha256: sha.repeat(64).slice(0, 64), contentId: "x", byteLength: mb * MB, category, archived: false, cold: false });

describe("flytten till förrådet: urval och ordning", () => {
  it("tävlingens kartor går sist, sedan grundfiler, underlag och först laserkörningar", () => {
    expect(categoryOf({ race: true, base: true, layer: true, laser: true })).toBe("RACE");
    expect(categoryOf({ race: false, base: true, layer: true, laser: true })).toBe("BASE");
    expect(categoryOf({ race: false, base: false, layer: true, laser: true })).toBe("UNDERLAY");
    expect(categoryOf({ race: false, base: false, layer: false, laser: true })).toBe("LASER");
    expect(categoryOf({ race: false, base: false, layer: false, laser: false })).toBe("BASE");
  });

  it("ordnar efter grupp och störst först inom gruppen", () => {
    const ordered = orderMigrateCandidates([candidate("a", "RACE", 900), candidate("b", "BASE", 5), candidate("c", "LASER", 10),
      candidate("d", "LASER", 300), candidate("e", "UNDERLAY", 1), candidate("f", "BASE", 50)]);
    expect(ordered.map(item => item.sha256[0])).toEqual(["d", "c", "e", "f", "b", "a"]);
  });
});

describe("flytten till förrådet: fönstret och inställningarna", () => {
  it("förvalen: på, kl. 1–6, 2048 MB per varv, 24 h frist", () => {
    expect(migrateSettings({})).toEqual({ enabled: true, fromHour: 1, toHour: 6, runBytes: 2048 * MB, graceHours: 24 });
    expect(migrateSettings({ OTID_STORE_MIGRATE: "off", OTID_STORE_MIGRATE_HOURS: "22-5", OTID_STORE_MIGRATE_RUN_MB: "512",
      OTID_STORE_MIGRATE_GRACE_HOURS: "48" })).toEqual({ enabled: false, fromHour: 22, toHour: 5, runBytes: 512 * MB, graceHours: 48 });
    expect(migrateSettings({ OTID_STORE_MIGRATE_HOURS: "3-3", OTID_STORE_MIGRATE_RUN_MB: "-1" })).toMatchObject({ fromHour: 1, toHour: 6, runBytes: 2048 * MB });
    expect(migrateSettingsProblems({ OTID_STORE_MIGRATE: "kanske", OTID_STORE_MIGRATE_HOURS: "natt", OTID_STORE_MIGRATE_RUN_MB: "0" })).toHaveLength(3);
    expect(migrateSettingsProblems({ OTID_STORE_MIGRATE_HOURS: "0-24" })).toEqual([]);
  });

  it("svensk tid, också över midnatt och sommartid", () => {
    expect(stockholmHour(new Date("2026-11-21T00:30:00Z"))).toBe(1);
    expect(stockholmHour(new Date("2026-07-01T23:30:00Z"))).toBe(1);
    const night = { fromHour: 1, toHour: 6 };
    expect(inMigrateWindow(new Date("2026-11-21T00:00:00Z"), night)).toBe(true);
    expect(inMigrateWindow(new Date("2026-11-21T04:59:00Z"), night)).toBe(true);
    expect(inMigrateWindow(new Date("2026-11-21T05:00:00Z"), night)).toBe(false);
    expect(inMigrateWindow(new Date("2026-11-21T23:59:00Z"), night)).toBe(false);
    expect(inMigrateWindow(new Date("2026-11-21T22:00:00Z"), { fromHour: 22, toHour: 5 })).toBe(true);
    expect(inMigrateWindow(new Date("2026-11-21T12:00:00Z"), { fromHour: 0, toHour: 24 })).toBe(true);
  });
});
