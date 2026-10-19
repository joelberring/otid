import { describe, expect, it } from "vitest";
import { orderMyEvents } from "./my-events-order";

const event = (name: string, ...dates: string[]) => ({ eventName: name, timeZone: "Europe/Stockholm", startsOn: dates[0]!,
  races: dates.map((raceDate, index) => ({ raceId: `${name}-${index}`, raceDate })) });

describe("orderMyEvents", () => {
  it("idag och kommande först (närmast först), sedan gångna (senaste först)", () => {
    const now = new Date("2026-10-19T20:00:00Z");
    const ordered = orderMyEvents([event("Gammal", "2026-09-01"), event("Idag", "2026-10-19"), event("Nästa år", "2027-05-01"),
      event("Förra veckan", "2026-10-12"), event("Snart", "2026-10-25")], now);
    expect(ordered.map((row) => row.eventName)).toEqual(["Idag", "Snart", "Nästa år", "Förra veckan", "Gammal"]);
  });

  it("ett arrangemang med flera lopp sorteras efter sitt närmaste kommande lopp; loppen likadant", () => {
    const now = new Date("2026-10-19T08:00:00Z");
    const ordered = orderMyEvents([event("Senare", "2026-11-10"), event("Helg", "2026-10-10", "2026-10-26", "2026-10-25")], now);
    expect(ordered.map((row) => row.eventName)).toEqual(["Helg", "Senare"]);
    expect(ordered[0]!.races.map((race) => race.raceDate)).toEqual(["2026-10-25", "2026-10-26", "2026-10-10"]);
  });

  it("idag räknas i arrangemangets tidszon (strax efter midnatt i Stockholm är det redan nästa dag)", () => {
    const now = new Date("2026-10-19T22:30:00Z");
    expect(orderMyEvents([event("Igår", "2026-10-19"), event("Idag", "2026-10-20")], now).map((row) => row.eventName))
      .toEqual(["Idag", "Igår"]);
  });
});
