import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { saveCourseSettingAsAdmin, setBingoAsAdmin, syncMastermindAsStaff } from "../../src";
import { db, useRaceDatabase } from "./race-fixtures";

/** Granskningen 2.12: en utloggad får 401 (unauthorized), inte 400, också med en ogiltig kropp. */
useRaceDatabase();
const anonymous = () => ({ sessionToken: null, raceId: randomUUID(), csrfCookie: null, csrfHeader: null, request: { ogiltig: true } });

describe("granskning 2.12: auktorisering före validering", () => {
  it("bingo, Mastermind och banläggningens sparande svarar unauthorized utan inloggning", async () => {
    expect(await setBingoAsAdmin(db, anonymous())).toEqual({ status: "unauthorized" });
    expect(await syncMastermindAsStaff(db, anonymous())).toEqual({ status: "unauthorized" });
    expect(await saveCourseSettingAsAdmin(db, anonymous())).toEqual({ status: "unauthorized" });
  });
});
