import { describe, expect, it } from "vitest";
import { clubInviteFromClubRequestSchema, invitationLinkViewSchema, invitationRoleFits, invitationRoleSchema } from "../src";

/** Städrundan C4: inbjudningarnas roller per slag (klubb, tävling, träningsgrupp); trådformatet är oförändrat. */
const uuid = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const view = (kind: string, role: string) => ({ formatVersion: 1, status: "valid", kind, targetName: "OK Påhitt", raceDate: null, role,
  inviterName: "Anna", email: "a@exempel.se", next: "/organizer", expiresAt: "2026-11-21T12:00:00Z" });

describe("inbjudningarnas roller", () => {
  it("varje roll hör till sitt slag", () => {
    expect(invitationRoleFits("CLUB", "READER")).toBe(true);
    expect(invitationRoleFits("CLUB", "MEMBER")).toBe(false);
    expect(invitationRoleFits("GROUP", "MEMBER")).toBe(true);
    expect(invitationRoleFits("GROUP", "READER")).toBe(false);
    expect(invitationRoleFits("RACE", "COURSE_MAP")).toBe(true);
    expect(invitationRoleFits("RACE", "OWNER")).toBe(false);
    // Alla tio värdena från förut går fortfarande igenom det gemensamma schemat.
    for (const role of ["OWNER", "ADMIN", "READER", "FUNCTIONARY", "COURSE_EDIT", "COURSE_SUGGEST", "COURSE_COMMENT", "COURSE_MAP", "LEADER", "MEMBER"]) {
      expect(invitationRoleSchema.safeParse(role).success).toBe(true);
    }
  });

  it("länksidan och Från klubben tar bara en roll som hör till slaget", () => {
    expect(invitationLinkViewSchema.safeParse(view("CLUB", "READER")).success).toBe(true);
    expect(invitationLinkViewSchema.safeParse(view("CLUB", "FUNCTIONARY")).success).toBe(false);
    const request = (kind: string, role: string) => ({ formatVersion: 1, requestId: uuid, context: { kind, id: uuid }, refs: [uuid], role });
    expect(clubInviteFromClubRequestSchema.safeParse(request("TRAINING_GROUP", "MEMBER")).success).toBe(true);
    expect(clubInviteFromClubRequestSchema.safeParse(request("TRAINING_GROUP", "READER")).success).toBe(false);
    expect(clubInviteFromClubRequestSchema.safeParse(request("RACE", "FUNCTIONARY")).success).toBe(true);
    expect(clubInviteFromClubRequestSchema.safeParse(request("CLUB", "FUNCTIONARY")).success).toBe(false);
  });
});
