import { describe, expect, it } from "vitest";
import { partyStartFields } from "./party-start-fields";

describe("fälten för festens start (användartestet 2026-11-12)", () => {
  it("är tomma tills starten är sparad, och visar den sparade starten i tävlingens tidszon", () => {
    expect(partyStartFields(null, "Europe/Stockholm")).toEqual({ date: "", clock: "", saved: false });
    expect(partyStartFields(undefined, "Europe/Stockholm")).toEqual({ date: "", clock: "", saved: false });
    expect(partyStartFields("2026-11-12T16:00:00.000Z", "Europe/Stockholm")).toEqual({ date: "2026-11-12", clock: "17:00", saved: true });
  });
});
