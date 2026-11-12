import { describe, expect, it } from "vitest";
import type { ClubArchiveListItem } from "@o-tid/contracts";
import { archiveSuggestions, sameWeeksEarlierYears } from "./club-plan-archive";

const entry = (title: string, trainingDate: string | null, year: number | null = trainingDate ? Number(trainingDate.slice(0, 4)) : null) =>
  ({ entryId: title, title, trainingDate, year, place: "", leader: null, tags: [], moments: [], levels: [], courseNames: [], courseFiles: 0, maps: [],
    status: "COMPLETE", thumbnail: null, thumbnailSource: null }) as ClubArchiveListItem;

describe("Hämta ur arkivet: ordningen", () => {
  it("samma vecka ± 1 i tidigare år först, sedan de senaste, utan datum sist", () => {
    // Vecka 37 2027 (13–19 september).
    const week = "2027-09-13";
    const entries = [entry("Förra månaden", "2027-08-10"), entry("Vecka 36 2025", "2025-09-02"), entry("Vecka 40 2026", "2026-09-29"),
      entry("Bara år", null, 2020), entry("Vecka 38 2026", "2026-09-15"), entry("Samma vecka i år", "2027-09-14")];
    expect(archiveSuggestions(entries, week).map(item => item.title)).toEqual(["Vecka 38 2026", "Vecka 36 2025", "Samma vecka i år",
      "Förra månaden", "Vecka 40 2026", "Bara år"]);
    expect(sameWeeksEarlierYears(entry("Utan datum", null), week)).toBe(false);
  });

  it("veckorna runt årsskiftet räknas som grannar", () => {
    expect(sameWeeksEarlierYears(entry("Vecka 52", "2025-12-23"), "2027-01-04")).toBe(true);
  });
});
