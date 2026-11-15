import type { Texts } from "../lib/language";
import type { clubLeadersSv } from "./club-leaders-sv";

export const clubLeadersEn: Texts<typeof clubLeadersSv> = {
  organiser: {
    legend: "Organising club",
    none: "No organising club",
    pickMine: (club: string) => `Choose ${club}`,
    choose: "Choose the organising club, or none.",
    search: "Search for another club",
    clear: "None",
    help: "For a training, the leaders in the club's club space become administrators, so they reach the admin view from the event page.",
    saveFailed: "The event was created, but the organising club was not saved. Choose it under Settings → The club and the club archive."
  },
  shortcut: {
    label: "Organiser shortcuts",
    admin: "To the admin view",
    bingoLeader: "Leader's table"
  }
};
