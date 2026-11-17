import type { Texts } from "../lib/language";
import type { clubLeadersSv } from "./club-leaders-sv";

export const clubLeadersEn: Texts<typeof clubLeadersSv> = {
  organiser: {
    legend: "Organising club",
    none: "No club (personal)",
    notChosen: "Not chosen",
    pickMine: (club: string) => `Choose ${club}`,
    choose: "Choose a club, or No club for a personal event or training. The choice decides, among other things, whether it ends up in the club archive.",
    required: "Choose the organising club, or No club.",
    search: "Search for another club",
    clear: "No club (personal)",
    help: "For a training, the leaders in the club's club space become administrators, so they reach the admin view from the event page.",
  },
  shortcut: {
    label: "Organiser shortcuts",
    admin: "To the admin view",
    bingoLeader: "Leader's table"
  }
};
