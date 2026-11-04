import { describe, expect, it } from "vitest";
import { INVITATION_LINK_LIFETIME_MS, invitationNext, invitationRecipientKey, newInvitationToken } from "../src/invitation-links";
import { sha256Hex } from "../src/serialization";

describe("ADR-0206: inbjudningslänkens nyckel", () => {
  it("är 32 slumpade byte som base64url, och bara hashen sparas", () => {
    const first = newInvitationToken();
    const second = newInvitationToken();
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(first.token, "base64url")).toHaveLength(32);
    expect(first.tokenHash).toBe(sha256Hex(first.token));
    expect(first.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.token).not.toBe(second.token);
  });

  it("gäller 14 dagar", () => {
    expect(INVITATION_LINK_LIFETIME_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("mottagaren i spärren är en HMAC, inte adressen", () => {
    const key = invitationRecipientKey("anna@klubb.se");
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("anna");
    expect(invitationRecipientKey("anna@klubb.se")).toBe(key);
  });

  it("efter inloggningen: klubben, gruppen, tävlingen eller banläggningen", () => {
    expect(invitationNext({ kind: "CLUB", clubId: "c1", name: "K" }, "READER")).toBe("/organizer/clubs/c1");
    expect(invitationNext({ kind: "GROUP", groupId: "g1", name: "G" }, "LEADER")).toBe("/organizer/groups/g1");
    expect(invitationNext({ kind: "GROUP", groupId: "g1", name: "G" }, "MEMBER")).toBe("/organizer");
    const race = { kind: "RACE" as const, raceId: "r1", name: "R", raceDate: "2027-01-01" };
    expect(invitationNext(race, "FUNCTIONARY")).toBe("/admin/r1/manage");
    expect(invitationNext(race, "ADMIN")).toBe("/admin/r1/manage");
    expect(invitationNext(race, "COURSE_SUGGEST")).toBe("/admin/r1/course-setting");
    expect(invitationNext(race, "COURSE_MAP")).toBe("/admin/r1/course-setting/map-errors");
  });
});
