"use client";

import React from "react";
import type { OrganizerMyEventsResponse } from "@o-tid/contracts";
import { organizerEn } from "../../i18n/organizer-en";
import { organizerSv } from "../../i18n/organizer-sv";
import { todayIn } from "../../lib/my-events-order";
import { raceListName } from "../../lib/race-list-name";
import { useTexts } from "../language-provider";
import styles from "./organizer-hub.module.css";

type MyEvent = OrganizerMyEventsResponse["events"][number];
type MyRace = MyEvent["races"][number];

export interface TodayRaceItem {
  event: MyEvent;
  race: MyRace;
}

const todayCardSv = {
  heading: "Dagens tävling",
  headingPlural: "Dagens tävlingar",
  openReadout: "Öppna avläsning"
} as const;

const todayCardEn = {
  heading: "Today's event",
  headingPlural: "Today's events",
  openReadout: "Open readout"
} as const;

/** Plockar ut de lopp som går i dag (räknat i arrangemangets tidszon). */
export function todaysRaces(events: readonly MyEvent[], now: Date): TodayRaceItem[] {
  const items: TodayRaceItem[] = [];
  for (const event of events) {
    const today = todayIn(event.timeZone, now);
    for (const race of event.races) {
      if (race.raceDate === today) items.push({ event, race });
    }
  }
  return items;
}

/**
 * Kompakt snabbkort överst i Mitt O-Tid när kontot har minst ett lopp i dag: direktväg till arbetsytan och avläsningen.
 */
export function TodayRaceCard({ events, busy, enteringRaceId, onOpen }: {
  events: readonly MyEvent[];
  busy: boolean;
  enteringRaceId?: string | undefined;
  onOpen: (raceId: string, page?: "manage" | "readout" | "course-setting" | "course-setting/map-errors") => void;
}) {
  const copy = useTexts(organizerSv, organizerEn);
  const cardText = useTexts(todayCardSv, todayCardEn);
  // Med bara ett arrangemang på kontot står det redan ensamt i listan; snabbkortet behövs när kontot har flera.
  if (events.length <= 1) return null;
  const items = todaysRaces(events, new Date());
  if (items.length === 0) return null;

  const title = items.length === 1 ? cardText.heading : cardText.headingPlural;
  return <section className={styles.todayCard} aria-label={title} data-testid="today-race-card">
    <p className={styles.todayKicker}>{title}</p>
    <div className={styles.todayList}>
      {items.map(({ event, race }) => {
        const subName = raceListName(race, event.races, copy.raceNumber);
        const disabled = busy || enteringRaceId !== undefined;
        return <div key={race.raceId} className={styles.todayRow}>
          <div className={styles.todayInfo}>
            <strong>{event.eventName}</strong>
            <span>{subName ? `${subName} · ` : ""}{race.raceDate}</span>
          </div>
          <div className={styles.todayActions}>
            {event.role !== "COURSE_SETTER" ? <>
              <button type="button" disabled={disabled} aria-busy={enteringRaceId === race.raceId}
                onClick={() => onOpen(race.raceId, "manage")}>
                {enteringRaceId === race.raceId ? copy.opening : copy.openRace}
              </button>
              <button type="button" className="secondary" disabled={disabled}
                onClick={() => onOpen(race.raceId, "readout")}>
                {cardText.openReadout}
              </button>
            </> : <button type="button" disabled={disabled} aria-busy={enteringRaceId === race.raceId}
              onClick={() => onOpen(race.raceId, race.courseSetting === "MAP" ? "course-setting/map-errors" : "course-setting")}>
              {race.courseSetting === "MAP" ? copy.openMapErrors : copy.openCourseSetting}
            </button>}
          </div>
        </div>;
      })}
    </div>
  </section>;
}
