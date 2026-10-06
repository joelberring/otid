import { describe, expect, it } from "vitest";
import { defaultRaceCopyDate, raceCopyRequestSchema } from "../src/race-copy";

describe("Ny tävling som … (PLAN.md steg 21)", () => {
  it("föreslår samma dag om källan inte passerat, annars samma veckodag en eller flera veckor senare", () => {
    expect(defaultRaceCopyDate("2026-10-08", "2026-10-06")).toBe("2026-10-08");
    expect(defaultRaceCopyDate("2026-10-06", "2026-10-06")).toBe("2026-10-06");
    expect(defaultRaceCopyDate("2026-09-29", "2026-10-06")).toBe("2026-10-06");
    expect(defaultRaceCopyDate("2026-10-01", "2026-10-06")).toBe("2026-10-08");
    expect(defaultRaceCopyDate("2026-09-10", "2026-10-06")).toBe("2026-10-08");
    expect(defaultRaceCopyDate("2026-03-26", "2026-03-30")).toBe("2026-04-02");
  });

  it("kräver namn, datum och valet om personer", () => {
    const request = { formatVersion: 1, requestId: "10000000-0000-4000-8000-000000000001", eventName: "Träning", raceName: "Torsdag",
      raceDate: "2026-10-15", includePeople: true };
    expect(raceCopyRequestSchema.safeParse(request).success).toBe(true);
    expect(raceCopyRequestSchema.safeParse({ ...request, eventName: "T" }).success).toBe(false);
    expect(raceCopyRequestSchema.safeParse({ ...request, raceDate: "15/10" }).success).toBe(false);
    expect(raceCopyRequestSchema.safeParse({ ...request, includePeople: undefined }).success).toBe(false);
  });
});
