import type { Texts } from "../lib/language";
import type { appTabsSv } from "./app-tabs-sv";

/** Förslag B: the tab bar at the bottom for signed-in users on a phone. */
export const appTabsEn: Texts<typeof appTabsSv> = {
  label: "Main menu",
  tabs: {
    home: "Home",
    maps: "Maps",
    courses: "Courses",
    events: "Trainings",
    club: "Club"
  }
};
