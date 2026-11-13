import { describe, expect, it } from "vitest";
import { mapProjectJoinLinkRoles, mapProjectJoinUrl, parseClubMembers, parseJoinLinkCreated, tokenFromHash } from "./map-project-invite-link";

const TOKEN = "a".repeat(43);

describe("länk till kartprojekt", () => {
  it("nyckeln står efter # (aldrig i frågan) och läses tillbaka", () => {
    const url = mapProjectJoinUrl("https://o-tid.example", TOKEN);
    expect(url).toBe(`https://o-tid.example/kartlank#token=${TOKEN}`);
    expect(new URL(url).search).toBe("");
    expect(tokenFromHash(new URL(url).hash)).toBe(TOKEN);
  });

  it("en nyckel med fel form eller utan nyckel ger inget", () => {
    expect(tokenFromHash("")).toBeUndefined();
    expect(tokenFromHash("#token=kort")).toBeUndefined();
    expect(tokenFromHash(`#annat=${TOKEN}`)).toBeUndefined();
  });

  it("en länk ger aldrig Ägare", () => {
    expect(mapProjectJoinLinkRoles).toEqual(["EDIT", "SUGGEST", "READ"]);
  });

  it("svaren från servern tolkas strikt", () => {
    const accountId = "11111111-1111-4111-8111-111111111111";
    expect(parseClubMembers({ formatVersion: 1, clubs: ["OK Test"], members: [{ accountId, name: "Anna", clubNames: ["OK Test"] }] }))
      .toMatchObject({ clubs: ["OK Test"] });
    expect(parseClubMembers({ formatVersion: 1, clubs: [], members: [{ accountId, name: "Anna", clubNames: [], email: "a@b.se" }] })).toBeUndefined();
    expect(parseJoinLinkCreated({ formatVersion: 1, linkId: accountId, token: TOKEN, expiresAt: "2026-11-27T10:00:00.000Z" })).toEqual({ token: TOKEN });
    expect(parseJoinLinkCreated({ token: "x" })).toBeUndefined();
  });
});
