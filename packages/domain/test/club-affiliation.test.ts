import { describe, expect, it } from "vitest";
import {
  affiliationConfirmedIn, CLUB_AREA_DEFAULTS, CLUB_ROLE_RANK, clubAreaAllowed, clubInitials, clubSearchMatches, clubSearchRank, clubSearchText, clubSearchTokens, derivedClubRole,
  effectiveClubRole, normalizeClubSearch, raceFinishedForArchive
} from "../src";

describe("ADR-0209: sökningen i klubblistan", () => {
  it("normaliserar bort accenter, stora bokstäver och skiljetecken", () => {
    expect(normalizeClubSearch("OK Älvsjö-Örby")).toBe("okalvsjoorby");
    expect(normalizeClubSearch("  Ängsbacka SOK ")).toBe("angsbackasok");
    expect(normalizeClubSearch("Søndre Ørsta IL")).toBe("sondreorstail");
    expect(normalizeClubSearch("Æbeltoft & Straße")).toBe("aebeltoftstrasse");
    expect(normalizeClubSearch("IFK Göteborg")).toBe("ifkgoteborg");
    expect(normalizeClubSearch("---")).toBe("");
  });

  it("initialerna behåller förkortningar och tar första bokstaven i andra ord", () => {
    expect(clubInitials("OK Älvsjö-Örby")).toBe("okao");
    expect(clubInitials("Järfälla OK")).toBe("jok");
    expect(clubInitials("Skogsfalken")).toBe("");
  });

  it("\"älvsjö\" och \"okäö\" hittar OK Älvsjö-Örby, också med kortnamnet", () => {
    const text = clubSearchText("OK Älvsjö-Örby", "Älvsjö-Örby");
    expect(text).toBe("okalvsjoorby alvsjoorby okao");
    expect(clubSearchMatches(text, "älvsjö")).toBe(true);
    expect(clubSearchMatches(text, "ALVSJO")).toBe(true);
    expect(clubSearchMatches(text, "okäö")).toBe(true);
    expect(clubSearchMatches(text, "ok örby")).toBe(true);
    expect(clubSearchMatches(text, "järfälla")).toBe(false);
    expect(clubSearchMatches(text, "   ")).toBe(false);
  });

  it("ett ord matchar inte över gränsen mellan namn och kortnamn", () => {
    const text = clubSearchText("Skogsby OK", "Skogsby");
    expect(clubSearchMatches(text, "okskogsby")).toBe(false);
    expect(clubSearchMatches(text, "skogsbyok")).toBe(true);
  });

  it("orden är normaliserade, unika och högst fem", () => {
    expect(clubSearchTokens("  Ok  ok Älvsjö - ")).toEqual(["ok", "alvsjo"]);
    expect(clubSearchTokens("a b c d e f g")).toHaveLength(5);
  });

  it("sorterar exakt träff först, sedan början av namnet", () => {
    const sok = clubSearchText("OK Älvsjö-Örby", "OKÄÖ");
    expect(clubSearchRank(sok, "okäö")).toBe(0);
    expect(clubSearchRank(sok, "ok")).toBe(1);
    expect(clubSearchRank(clubSearchText("Järfälla OK"), "ok")).toBe(3);
  });
});

describe("ADR-0209: vad en tillhörighet ger", () => {
  const link = { clubId: "klubb-1", organisationId: "org-1" };

  it("en egen anmälan (väntar eller avböjd) ger ingenting", () => {
    expect(derivedClubRole([{ status: "PENDING", clubId: null, organisationId: "org-1" }], link)).toBeUndefined();
    expect(derivedClubRole([{ status: "DECLINED", clubId: "klubb-1", organisationId: "org-1" }], link)).toBeUndefined();
  });

  it("bekräftad av arkivet ger läsare, men bara i det arkivet och för samma klubb", () => {
    const confirmed = { status: "CONFIRMED" as const, clubId: "klubb-1", organisationId: "org-1" };
    expect(derivedClubRole([confirmed], link)).toBe("READER");
    expect(derivedClubRole([confirmed], { ...link, clubId: "klubb-2" })).toBeUndefined();
    expect(affiliationConfirmedIn(confirmed, { ...link, organisationId: "org-2" })).toBe(false);
    expect(affiliationConfirmedIn(confirmed, { ...link, organisationId: null })).toBe(false);
  });

  it("fritext som arkivet har matchat gäller utan koppling till listan", () => {
    expect(derivedClubRole([{ status: "CONFIRMED", clubId: "klubb-1", organisationId: null }], { ...link, organisationId: null })).toBe("READER");
  });

  it("tas tillhörigheten bort försvinner rätten", () => {
    expect(derivedClubRole([], link)).toBeUndefined();
  });

  it("Vem ser vad: medlemmar eller bara ledare och administratörer", () => {
    expect(clubAreaAllowed("READER", "MEMBERS")).toBe(true);
    expect(clubAreaAllowed("READER", "LEADERS")).toBe(false);
    expect(clubAreaAllowed("LEADER", "LEADERS")).toBe(true);
    expect(clubAreaAllowed("ADMIN", "LEADERS")).toBe(true);
    expect(CLUB_AREA_DEFAULTS).toEqual({ ARCHIVE: "MEMBERS", MAP_BANK: "MEMBERS" });
  });

  it("den högsta av uttrycklig och härledd roll gäller", () => {
    expect(effectiveClubRole(undefined, "READER")).toBe("READER");
    expect(effectiveClubRole("ADMIN", "READER")).toBe("ADMIN");
    expect(effectiveClubRole("LEADER", "READER")).toBe("LEADER");
    expect(effectiveClubRole("READER", undefined)).toBe("READER");
    expect(effectiveClubRole(undefined, undefined)).toBeUndefined();
  });

  it("tävlingen är klar dagen efter eller när banorna är publika", () => {
    expect(raceFinishedForArchive({ raceDate: "2026-11-03", today: "2026-11-03", coursesPublic: false })).toBe(false);
    expect(raceFinishedForArchive({ raceDate: "2026-11-03", today: "2026-11-04", coursesPublic: false })).toBe(true);
    expect(raceFinishedForArchive({ raceDate: "2026-11-03", today: "2026-11-02", coursesPublic: true })).toBe(true);
  });
});

describe("klubbrollernas rang", () => {
  it("läsare < ledare < administratör < ägare", () => {
    const roles: (keyof typeof CLUB_ROLE_RANK)[] = ["OWNER", "READER", "ADMIN", "LEADER"];
    const order = roles.sort((a, b) => CLUB_ROLE_RANK[a] - CLUB_ROLE_RANK[b]);
    expect(order).toEqual(["READER", "LEADER", "ADMIN", "OWNER"]);
  });
});
