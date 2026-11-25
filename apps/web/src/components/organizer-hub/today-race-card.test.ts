import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OrganizerMyEventsResponse } from "@o-tid/contracts";
import { todayIn } from "../../lib/my-events-order";
import { TodayRaceCard, todaysRaces } from "./today-race-card";

const makeEvent = (id: string, raceDate: string, timeZone = "Europe/Stockholm"): OrganizerMyEventsResponse["events"][number] => ({
  eventId: id,
  eventName: `Event ${id}`,
  startsOn: raceDate,
  timeZone,
  role: "OWNER",
  races: [{ raceId: `race-${id}`, raceName: "", raceDate, raceType: "TRAINING" }]
});

describe("todaysRaces", () => {
  it("picks only races scheduled for today in each event's time zone", () => {
    const now = new Date("2026-11-25T10:00:00.000Z");
    const events = [
      makeEvent("past", "2026-11-24"),
      makeEvent("today", "2026-11-25"),
      makeEvent("future", "2026-11-26")
    ];
    const items = todaysRaces(events, now);
    expect(items.map(item => item.race.raceId)).toEqual(["race-today"]);
  });

  it("renders TodayRaceCard only when the account has more than one event", () => {
    const today = todayIn("Europe/Stockholm", new Date());
    const single = renderToStaticMarkup(React.createElement(TodayRaceCard, {
      events: [makeEvent("today", today)],
      busy: false,
      onOpen: () => undefined
    }));
    expect(single).toBe("");

    const multiple = renderToStaticMarkup(React.createElement(TodayRaceCard, {
      events: [makeEvent("today", today), makeEvent("other", "2020-01-01")],
      busy: false,
      onOpen: () => undefined
    }));
    expect(multiple).toContain("Dagens tävling");
    expect(multiple).toContain("Event today");
    expect(multiple).toContain("Öppna avläsning");
  });
});
