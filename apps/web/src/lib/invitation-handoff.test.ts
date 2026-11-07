import { describe, expect, it } from "vitest";
import { safePath } from "./invitation-handoff";

describe("inbjudans sida efter inloggningen", () => {
  it("bara en sökväg i O-Tid, aldrig en annan värd", () => {
    expect(safePath("/organizer/clubs/abc-123")).toBe(true);
    for (const path of ["//evil", "//evil/organizer", "https://evil.example", "/\\evil", "organizer", "/", "", null]) expect(safePath(path), String(path)).toBe(false);
  });
});
