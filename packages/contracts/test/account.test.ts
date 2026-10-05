import { describe, expect, it } from "vitest";
import {
  accountEmailSchema, normalizeAccountEmail, organizerAccountRegistrationRequestSchema, passwordResetCompleteRequestSchema,
  superadminActionRequestSchema
} from "../src";

describe("ADR-0172 konton med e-post", () => {
  it("normaliserar adressen: blanksteg, versaler och Unicode-form", () => {
    expect(normalizeAccountEmail("  Anna.Arrangor@Klubb.SE ")).toBe("anna.arrangor@klubb.se");
    expect(normalizeAccountEmail("Äsa@klubb.se")).toBe("äsa@klubb.se");
    expect(normalizeAccountEmail("demo@o-tid.local")).toBe("demo@o-tid.local");
    expect(normalizeAccountEmail("namn+tagg@sub.klubb.se")).toBe("namn+tagg@sub.klubb.se");
  });

  it("avvisar sådant som inte är en e-postadress", () => {
    for (const value of ["", "anna", "anna@", "@klubb.se", "anna@klubb", "an na@klubb.se", "a@@klubb.se",
      "anna@klubb..se", "anna@.klubb.se", `${"a".repeat(65)}@klubb.se`, `a@${"b".repeat(250)}.se`]) {
      expect(normalizeAccountEmail(value), value).toBeUndefined();
      expect(accountEmailSchema.safeParse(value).success).toBe(false);
    }
  });

  it("kräver minst åtta tecken i lösenordet vid registrering och återställning", () => {
    const registration = { formatVersion: 1 as const, email: "x@klubb.se", displayName: "X", password: "1234567" };
    expect(organizerAccountRegistrationRequestSchema.safeParse(registration).success).toBe(false);
    expect(organizerAccountRegistrationRequestSchema.safeParse({ ...registration, password: "12345678" }).success).toBe(true);
    const token = "A".repeat(43);
    expect(passwordResetCompleteRequestSchema.safeParse({ formatVersion: 1, token, password: "kort" }).success).toBe(false);
    expect(passwordResetCompleteRequestSchema.safeParse({ formatVersion: 1, token: "kort", password: "langt-nog" }).success).toBe(false);
  });

  it("kräver skäl för varje superadminåtgärd och bekräftelse vid borttagning", () => {
    const accountId = "50000000-0000-4000-8000-000000000005";
    expect(superadminActionRequestSchema.safeParse({ formatVersion: 1, action: "BLOCK_ACCOUNT", accountId, reason: " " }).success).toBe(false);
    expect(superadminActionRequestSchema.safeParse({ formatVersion: 1, action: "DELETE_ACCOUNT", accountId, reason: "Skräp" }).success).toBe(false);
    expect(superadminActionRequestSchema.safeParse({ formatVersion: 1, action: "DELETE_ACCOUNT", accountId, reason: "Skräp",
      confirmation: "x@klubb.se" }).success).toBe(true);
  });
});
