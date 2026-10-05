import { describe, expect, it } from "vitest";
import { racePeopleResponseSchema, racePersonGrantIdempotencyKeySchema, racePersonGrantRequestSchema } from "../src";

const id = "10000000-0000-4000-8000-000000000001";

describe("Personer med behörighet (ADR-0172 beslut 3)", () => {
  it("lägger bara till administratör eller funktionär och normaliserar e-posten", () => {
    const request = { formatVersion: 1, requestId: id, email: " Kim@Klubb.SE ", role: "FUNCTIONARY" };
    expect(racePersonGrantRequestSchema.parse(request).email).toBe("kim@klubb.se");
    expect(racePersonGrantRequestSchema.safeParse({ ...request, role: "OWNER" }).success).toBe(false);
    expect(racePersonGrantRequestSchema.safeParse({ ...request, email: "ingen-adress" }).success).toBe(false);
    expect(racePersonGrantIdempotencyKeySchema.safeParse(`race-person-grant:${id}`).success).toBe(true);
    expect(racePersonGrantIdempotencyKeySchema.safeParse(`organizer-admin-grant:${id}`).success).toBe(false);
  });

  it("listar ägare, administratörer och funktionärer men visar aldrig en funktionär som tittare", () => {
    const person = { grantId: id, accountId: id, email: "kim@klubb.se", displayName: "Kim", role: "FUNCTIONARY",
      grantedAt: "2026-10-05T10:00:00.000Z" };
    const list = { formatVersion: 1, raceId: id, viewer: { accountId: id, role: "OWNER" }, people: [person] };
    expect(racePeopleResponseSchema.parse(list).people[0]?.role).toBe("FUNCTIONARY");
    expect(racePeopleResponseSchema.safeParse({ ...list, viewer: { accountId: id, role: "FUNCTIONARY" } }).success).toBe(false);
  });
});
