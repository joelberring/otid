import { describe, expect, it } from "vitest";
import {
  isMapLinkToken, mapLinkExpiresAt, mapLinkOpenJournaled, mapLinkStatus, mapMakerName, suggestedMapLinkLastDay
} from "./map-link";

/** ADR-0214: kartritarens länk – nyckelns form, sista dagen, läget och namnet. */
describe("kartritarens länk", () => {
  it("känner igen nyckelns form (43 tecken base64url) och inget annat", () => {
    expect(isMapLinkToken("A".repeat(43))).toBe(true);
    expect(isMapLinkToken("abc-DEF_0123456789abcdefghijklmnopqrstuvwxy")).toBe(true);
    expect(isMapLinkToken("A".repeat(42))).toBe(false);
    expect(isMapLinkToken("A".repeat(44))).toBe(false);
    expect(isMapLinkToken(`${"A".repeat(42)}=`)).toBe(false);
    expect(isMapLinkToken(`${"A".repeat(42)}/`)).toBe(false);
    expect(isMapLinkToken("")).toBe(false);
  });

  it("föreslår tävlingsdagen plus en vecka, aldrig ett datum som redan passerat", () => {
    expect(suggestedMapLinkLastDay("2026-11-20", "2026-11-05")).toBe("2026-11-27");
    expect(suggestedMapLinkLastDay("2026-12-28", "2026-11-05")).toBe("2027-01-04");
    expect(suggestedMapLinkLastDay("2026-10-01", "2026-11-05")).toBe("2026-11-12");
  });

  it("gäller till och med sista dagen i tävlingens tidszon (midnatt efter, också vid sommartidens slut)", () => {
    expect(mapLinkExpiresAt("2026-11-27", "Europe/Stockholm")?.toISOString()).toBe("2026-11-27T23:00:00.000Z");
    expect(mapLinkExpiresAt("2026-07-01", "Europe/Stockholm")?.toISOString()).toBe("2026-07-01T22:00:00.000Z");
    // Natten då sommartiden slutar (25 oktober 2026): midnatt efter den 24:e är fortfarande sommartid.
    expect(mapLinkExpiresAt("2026-10-24", "Europe/Stockholm")?.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(mapLinkExpiresAt("2026-11-27", "UTC")?.toISOString()).toBe("2026-11-28T00:00:00.000Z");
  });

  it("avvisar datum som inte finns", () => {
    for (const value of ["2026-02-30", "2026-13-01", "26-11-27", "2026-11-27T00:00", ""]) expect(mapLinkExpiresAt(value, "Europe/Stockholm"), value).toBeNull();
  });

  it("räknar läget: avstängd före utgången, utgången precis vid tiden, annars aktiv", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    expect(mapLinkStatus({ expiresAt: null, revokedAt: null }, now)).toBe("ACTIVE");
    expect(mapLinkStatus({ expiresAt: new Date("2026-11-05T12:00:01Z"), revokedAt: null }, now)).toBe("ACTIVE");
    expect(mapLinkStatus({ expiresAt: new Date("2026-11-05T12:00:00Z"), revokedAt: null }, now)).toBe("EXPIRED");
    expect(mapLinkStatus({ expiresAt: new Date("2026-11-04T00:00:00Z"), revokedAt: null }, now)).toBe("EXPIRED");
    expect(mapLinkStatus({ expiresAt: new Date("2026-11-04T00:00:00Z"), revokedAt: new Date("2026-11-01T00:00:00Z") }, now)).toBe("REVOKED");
    expect(mapLinkStatus({ expiresAt: null, revokedAt: new Date("2026-11-05T11:00:00Z") }, now)).toBe("REVOKED");
  });

  it("journalför öppnandet högst en gång i timmen", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    expect(mapLinkOpenJournaled(null, now)).toBe(true);
    expect(mapLinkOpenJournaled(new Date("2026-11-05T11:30:00Z"), now)).toBe(false);
    expect(mapLinkOpenJournaled(new Date("2026-11-05T11:00:00Z"), now)).toBe(true);
  });

  it("städar namnet kartritaren skriver", () => {
    expect(mapMakerName("  Kim   Karta ")).toBe("Kim Karta");
    expect(mapMakerName("")).toBeNull();
    expect(mapMakerName("   ")).toBeNull();
    expect(mapMakerName(null)).toBeNull();
    expect(mapMakerName("a\u0000b\nc")).toBe("ab c");
    expect(mapMakerName("x".repeat(100))).toHaveLength(80);
  });
});
