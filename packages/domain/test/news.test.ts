import { describe, expect, it } from "vitest";
import { canWriteClubNews, homeNews, HOME_NEWS_LIMIT, isInternalNewsLink, normalizedNewsLink, type NewsVisibilityItem } from "../src";

/** ADR-0230: vem som ser vilka nyheter i startsidans spalt, vem som skriver och vilka länkar som godtas. */
const NOW = new Date("2026-11-21T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
type Item = NewsVisibilityItem & { id: string };
const item = (id: string, clubId: string | null, days: number, hidden = false): Item => ({ id, clubId, publishedAt: daysAgo(days), hidden });
const ids = (items: readonly Item[]) => items.map(entry => entry.id);

describe("startsidans nyheter", () => {
  const items = [item("allmän-1", null, 1), item("okäö", "klubb-a", 2), item("centrum", "klubb-b", 3), item("allmän-2", null, 4),
    item("dold", null, 0, true)];

  it("utloggad ser bara allmänna nyheter, nyast först, aldrig dolda", () => {
    expect(ids(homeNews(items, new Set(), NOW))).toEqual(["allmän-1", "allmän-2"]);
  });

  it("en medlem ser sin klubbs nyheter blandade med de allmänna i datumordning, inte andra klubbars", () => {
    expect(ids(homeNews(items, new Set(["klubb-a"]), NOW))).toEqual(["allmän-1", "okäö", "allmän-2"]);
    expect(ids(homeNews(items, new Set(["klubb-b"]), NOW))).toEqual(["allmän-1", "centrum", "allmän-2"]);
  });

  it("högst tre rader", () => {
    expect(homeNews(items, new Set(["klubb-a", "klubb-b"]), NOW)).toHaveLength(HOME_NEWS_LIMIT);
  });

  it("spalten döljs när den senaste synliga nyheten är äldre än 60 dagar", () => {
    expect(ids(homeNews([item("gammal", null, 60)], new Set(), NOW))).toEqual(["gammal"]);
    expect(homeNews([item("för-gammal", null, 61), item("klubb", "klubb-a", 1)], new Set(), NOW)).toEqual([]);
    // Klubbens färska nyhet håller spalten öppen för medlemmen, och de äldre allmänna följer med.
    expect(ids(homeNews([item("för-gammal", null, 61), item("klubb", "klubb-a", 1)], new Set(["klubb-a"]), NOW))).toEqual(["klubb", "för-gammal"]);
  });

  it("en nyhet med datum i framtiden visas inte än", () => {
    expect(homeNews([item("sen", null, -1)], new Set(), NOW)).toEqual([]);
  });
});

describe("vem skriver klubbens nyheter", () => {
  it("ledare, administratörer och ägare; inte medlemmar eller den som inte är med", () => {
    expect(canWriteClubNews("OWNER")).toBe(true);
    expect(canWriteClubNews("ADMIN")).toBe(true);
    expect(canWriteClubNews("LEADER")).toBe(true);
    expect(canWriteClubNews("READER")).toBe(false);
    expect(canWriteClubNews(undefined)).toBe(false);
  });
});

describe("nyhetens länk", () => {
  it("godtar interna sökvägar och http(s)", () => {
    expect(normalizedNewsLink("/om")).toBe("/om");
    expect(normalizedNewsLink(" /t/abc234#live ")).toBe("/t/abc234#live");
    expect(normalizedNewsLink("https://otid.berring.se/media/film.mp4")).toBe("https://otid.berring.se/media/film.mp4");
    expect(normalizedNewsLink("http://example.se")).toBe("http://example.se/");
  });

  it("avvisar annat", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "mailto:a@b.se", "//evil.example", "/\\evil", "https://user:pw@example.se",
      "ftp://example.se", "om", "", "/ med blanksteg", `/${"a".repeat(600)}`]) expect(normalizedNewsLink(bad), bad).toBeUndefined();
  });

  it("intern eller extern", () => {
    expect(isInternalNewsLink("/om")).toBe(true);
    expect(isInternalNewsLink("https://example.se/")).toBe(false);
  });
});
