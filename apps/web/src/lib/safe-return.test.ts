import { describe, expect, it } from "vitest";
import { isLoginReturnPath, isSafeReturnPath } from "./safe-return";

describe("säker returadress (användartestet 2026-11-12)", () => {
  it("godtar bara sökvägar på samma webbplats", () => {
    for (const ok of ["/", "/admin/abc/manage", "/organizer/clubs/1?flik=kartor", "/results/x#y"]) expect(isSafeReturnPath(ok), ok).toBe(true);
    for (const bad of ["", "//evil.example", "/\\evil.example", "https://evil.example/", "javascript:alert(1)", "admin/x",
      "/admin/x\nSet-Cookie: a", "/admin x", "/a\\b", undefined, 42, `/${"a".repeat(2001)}`]) {
      expect(isSafeReturnPath(bad), String(bad)).toBe(false);
    }
  });

  it("efter inloggningen bara tillbaka till tävlingens sidor och undersidor under Mina tävlingar", () => {
    expect(isLoginReturnPath("/admin/2c8e/manage")).toBe(true);
    expect(isLoginReturnPath("/admin/2c8e/speaker?vy=mal")).toBe(true);
    expect(isLoginReturnPath("/organizer/clubs/7")).toBe(true);
    expect(isLoginReturnPath("/organizer")).toBe(false);
    expect(isLoginReturnPath("/admin")).toBe(false);
    expect(isLoginReturnPath("/om")).toBe(false);
    expect(isLoginReturnPath("//admin/x")).toBe(false);
    expect(isLoginReturnPath("https://evil.example/admin/x")).toBe(false);
  });
});
