import { describe, expect, it } from "vitest";
import { ANY_UUID_PATTERN, sha256HexSchema, UUID_PATTERN } from "../src";

describe("id- och hashmönstren", () => {
  it("sha256HexSchema tar 64 hextecken i gemener och inget annat", () => {
    expect(sha256HexSchema.safeParse("a".repeat(64)).success).toBe(true);
    expect(sha256HexSchema.safeParse("0123456789abcdef".repeat(4)).success).toBe(true);
    expect(sha256HexSchema.safeParse("A".repeat(64)).success).toBe(false);
    expect(sha256HexSchema.safeParse("a".repeat(63)).success).toBe(false);
    expect(sha256HexSchema.safeParse("g".repeat(64)).success).toBe(false);
  });

  it("ANY_UUID_PATTERN tar alla versioner, UUID_PATTERN bara version 1–8", () => {
    const nil = "00000000-0000-0000-0000-000000000000";
    expect(ANY_UUID_PATTERN.test(nil)).toBe(true);
    expect(UUID_PATTERN.test(nil)).toBe(false);
    expect(ANY_UUID_PATTERN.test("10000000-0000-4000-8000-000000000001")).toBe(true);
    expect(ANY_UUID_PATTERN.test("10000000-0000-4000-8000-00000000000G")).toBe(false);
  });
});
