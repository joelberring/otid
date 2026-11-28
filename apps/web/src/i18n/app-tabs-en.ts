import type { Texts } from "../lib/language";
import type { appTabsSv } from "./app-tabs-sv";

/** Förslag B: the tab bar at the bottom for signed-in users on a phone; step F1: the left menu and the phone header. */
export const appTabsEn: Texts<typeof appTabsSv> = {
  label: "Main menu",
  tabs: {
    home: "Home",
    maps: "Maps",
    courses: "Courses",
    events: "Trainings",
    club: "Club"
  },
  titles: {
    hub: "My O-Tid",
    account: "My account",
    superadmin: "Superadmin"
  },
  back: "Back",
  start: "O-Tid, to the start page"
};
