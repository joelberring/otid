import type { Texts } from "../lib/language";
import type { raceTabsSv } from "./race-tabs-sv";

/** The race's own tab bar on a phone. */
export const raceTabsEn: Texts<typeof raceTabsSv> = {
  label: "Race menu",
  back: "My O-Tid",
  backLabel: "Back to My O-Tid",
  mode: "Mode",
  modes: { PREPARE: "Prepare", RACE_DAY: "Race day" },
  more: "More",
  moreTitle: "More in this event",
  switchFunction: "Switch function",
  switchTitle: "Switch function",
  close: "Close",
  refresh: "Refresh overview",
  newTab: "opens in a new tab so the station stays connected",
  tabs: {
    COURSES: "Courses", COURSES_CLASSES: "Courses", CONTROLS_POINTS: "Controls", CLASSES: "Classes", CLASSES_LEGS: "Classes",
    ENTRIES: "Entries", PARTICIPANTS: "Participants", TEAMS: "Teams", START: "Start", PUBLISH: "Publish", SECRETARIAT: "Secretariat",
    RESULTS: "Results", PARTY: "Party", PEOPLE: "People", SETTINGS: "Settings", READOUT_STATION: "Readout",
    PARTY_DESK: "Bar desk", SPEAKER: "Speaker", COURSE_SETTING: "Course setting", MAP_ERRORS: "Map errors", EXERCISE_SETUP: "Exercise",
    MASTERMIND: "Mastermind", BINGO: "Bingo", SHIPS: "Battleships", CONTROLS: "Controls"
  },
  items: {
    COURSES: ["Courses", "Course file, courses and forkings"], COURSES_CLASSES: ["Courses & classes", "Courses and classes in one place"],
    CONTROLS_POINTS: ["Controls & points", "Control points, classes and time limit"], CLASSES: ["Classes", "Classes and courses"],
    CLASSES_LEGS: ["Classes & legs", "Relay classes and legs"], ENTRIES: ["Entries", "Entries, import and cards"],
    PARTICIPANTS: ["Participants", "Participants and cards"], TEAMS: ["Teams", "Teams and leg runners"],
    START: ["Start", "Start lists, draw and maps for the start"], PUBLISH: ["Publish", "The race and the start list"],
    SECRETARIAT: ["Secretariat", "Still in the forest, unknown cards, mispunches, entry on the day"],
    RESULTS: ["Results", "Result lists and finalising"], PARTY: ["Party", "Goods, guests and purchases"],
    PEOPLE: ["People", "Administrators, officials and course setters"], SETTINGS: ["Settings", "Name, date, type and connections"],
    READOUT_STATION: ["Readout", "The readout station"], PARTY_DESK: ["Bar desk", "The bar desk with the card"],
    SPEAKER: ["Speaker", "The speaker's board"], COURSE_SETTING: ["Course setting", "The map, the controls and printing"],
    MAP_ERRORS: ["Map errors", "Map errors for the course setter"], EXERCISE_SETUP: ["Exercise on the phone", "Bingo, Battleships and virtual controls"],
    MASTERMIND: ["Mastermind with controls", "A game with SI units: each colour is a control, the team guesses the pattern"], 
    BINGO: ["Bingo", "The leader's page"], SHIPS: ["Battleships", "The leader's page"], CONTROLS: ["Virtual controls", "The leader's page"]
  }
};
