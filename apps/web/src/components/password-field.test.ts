import { describe, expect, it } from "vitest";
import { passwordMismatch, passwordsReady } from "./password-field";

/** ADR-0205: lösenordet två gånger, med besked medan personen skriver. */
describe("lösenordet två gånger", () => {
  it("säger till så fort upprepningen skiljer sig, inte medan den bara är kortare", () => {
    expect(passwordMismatch("rätt-lösen-1", "")).toBe(false);
    expect(passwordMismatch("rätt-lösen-1", "rätt-")).toBe(false);
    expect(passwordMismatch("rätt-lösen-1", "rätt-x")).toBe(true);
    expect(passwordMismatch("rätt-lösen-1", "rätt-lösen-1x")).toBe(true);
    expect(passwordMismatch("rätt-lösen-1", "rätt-lösen-1")).toBe(false);
  });
  it("skickar bara när båda är lika och minst 8 tecken", () => {
    expect(passwordsReady("rätt-lösen-1", "rätt-lösen-1")).toBe(true);
    expect(passwordsReady("kort", "kort")).toBe(false);
    expect(passwordsReady("rätt-lösen-1", "rätt-lösen-2")).toBe(false);
  });
});
