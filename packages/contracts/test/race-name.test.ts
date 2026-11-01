import { describe, expect, it } from "vitest";
import { createEventSchema, organizerEventCreateRequestSchema, raceNameSchema, raceSettingsRequestSchema,
  startListPublicationContentSchema } from "../src";

describe("loppets namn är valfritt", () => {
  it("trimmas, får vara tomt och högst 160 tecken", () => {
    expect(raceNameSchema.parse("")).toBe("");
    expect(raceNameSchema.parse("   ")).toBe("");
    expect(raceNameSchema.parse(" Etapp 1 ")).toBe("Etapp 1");
    expect(raceNameSchema.parse("E")).toBe("E");
    expect(raceNameSchema.safeParse("x".repeat(160)).success).toBe(true);
    expect(raceNameSchema.safeParse("x".repeat(161)).success).toBe(false);
  });

  it("skapande och inställningar tar emot tomt namn", () => {
    expect(organizerEventCreateRequestSchema.parse({ formatVersion: 1, eventName: "Natt-KM", raceName: "", raceDate: "2026-11-01",
      timeZone: "Europe/Stockholm" }).raceName).toBe("");
    expect(createEventSchema.parse({ name: "Natt-KM", raceName: " ", raceDate: "2026-11-01" }).raceName).toBe("");
    expect(raceSettingsRequestSchema.parse({ formatVersion: 1, requestId: "10000000-0000-4000-8000-000000000001",
      eventName: "Natt-KM", raceName: "", raceDate: "2026-11-01", raceType: "TRAINING" }).raceName).toBe("");
    // Tävlingens namn krävs fortfarande.
    expect(raceSettingsRequestSchema.safeParse({ formatVersion: 1, requestId: "10000000-0000-4000-8000-000000000001",
      eventName: "", raceName: "", raceDate: "2026-11-01", raceType: "TRAINING" }).success).toBe(false);
  });

  it("publicerad startlista tål tomt loppnamn", () => {
    expect(startListPublicationContentSchema.safeParse({ eventName: "Natt-KM", raceName: "", raceDate: "2026-11-01",
      timeZone: "Europe/Stockholm", classes: [] }).success).toBe(true);
  });
});
