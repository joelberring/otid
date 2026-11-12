import { describe, expect, it } from "vitest";
import { accessSituation } from "./access-situation";

describe("beskedet när en tävlingssida inte öppnas (användartestet 2026-11-12)", () => {
  it("skiljer på inte inloggad, obekräftad adress och inloggad utan behörighet", () => {
    expect(accessSituation(undefined)).toEqual({ kind: "signed-out" });
    expect(accessSituation({ email: "ada@example.test", emailVerified: false })).toEqual({ kind: "unverified", email: "ada@example.test" });
    expect(accessSituation({ email: "ada@example.test", emailVerified: true })).toEqual({ kind: "no-access", email: "ada@example.test" });
    // Äldre svar utan fältet: kontot räknas som bekräftat (ADR-0186, befintliga konton).
    expect(accessSituation({ email: "ada@example.test" })).toEqual({ kind: "no-access", email: "ada@example.test" });
  });
});
