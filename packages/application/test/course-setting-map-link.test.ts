import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isMapLinkToken } from "@o-tid/domain";
import { newMapLinkToken } from "../src/course-setting-map-link";

/** ADR-0214: nyckeln till kartritarens länk är 256 slumpade bitar i base64url och bara dess sha256 sparas. */
describe("nyckeln till kartritarens länk", () => {
  it("är 43 tecken base64url (32 byte) med sha256 som hex", () => {
    const { token, tokenHash } = newMapLinkToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(isMapLinkToken(token)).toBe(true);
    expect(tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(tokenHash).not.toContain(token);
  });

  it("är ny varje gång", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newMapLinkToken().token));
    expect(tokens.size).toBe(200);
  });
});
