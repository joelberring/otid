import { describe, expect, it } from "vitest";
import { mobileExerciseApplies, mobileExerciseLink } from "./mobile-exercise";

const raceId = "00000000-0000-4000-8000-000000000001";

describe("Övning i mobilen i arbetsytan (översynen 2026-11-17)", () => {
  it("Träning utan påslagen övning leder till fliken Träning i banläggningen", () => {
    expect(mobileExerciseLink({ raceId, raceType: "TRAINING", admin: true, bingo: undefined }))
      .toEqual({ target: "SETUP", href: `/admin/${raceId}/course-setting?flik=traning` });
    expect(mobileExerciseLink({ raceId, raceType: "TRAINING", admin: true, bingo: { enabled: false, mode: "BINGO" } })?.target).toBe("SETUP");
  });
  it("en påslagen övning leder till ledarens sida, också i andra typer", () => {
    for (const raceType of ["TRAINING", "STANDARD", "ROGAINING"] as const) {
      expect(mobileExerciseLink({ raceId, raceType, admin: true, bingo: { enabled: true, mode: "SHIPS" } }))
        .toEqual({ target: "LEADER", href: `/admin/${raceId}/bingo`, mode: "SHIPS" });
    }
  });
  it("visas inte för funktionären, inte för en fest och inte för andra typer utan påslagen övning", () => {
    expect(mobileExerciseLink({ raceId, raceType: "TRAINING", admin: false, bingo: { enabled: true, mode: "BINGO" } })).toBeUndefined();
    expect(mobileExerciseLink({ raceId, raceType: "PARTY", admin: true, bingo: { enabled: true, mode: "BINGO" } })).toBeUndefined();
    expect(mobileExerciseLink({ raceId, raceType: "STANDARD", admin: true, bingo: { enabled: false, mode: "BINGO" } })).toBeUndefined();
    expect(mobileExerciseLink({ raceId, raceType: "RELAY", admin: true, bingo: undefined })).toBeUndefined();
  });
  it("frågar servern bara för administratören och inte för en fest", () => {
    expect(mobileExerciseApplies("STANDARD", true)).toBe(true);
    expect(mobileExerciseApplies("PARTY", true)).toBe(false);
    expect(mobileExerciseApplies("TRAINING", false)).toBe(false);
    expect(mobileExerciseApplies(undefined, true)).toBe(false);
  });
});
