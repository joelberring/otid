import type { Texts } from "../lib/language";
import { plural } from "./plural";
import type { raceTypeSv } from "./race-type-sv";
import type { raceWorkspaceNavigationSv, sectionStatusSv } from "./race-workspace-navigation-sv";

/**
 * Engelska, arbetsytan del 1 (idéerna 2026-11-08): skalet (toppbalken, sidopanelen och delarnas läge), tävlingstyperna,
 * Inställningar och Personer med behörighet. Samma form som de svenska texterna.
 */
export const raceTypeEn: Texts<typeof raceTypeSv> = {
  types: {
    TRAINING: { name: "Training", help: "Free start. Courses and classes in one place, participants, readout and results." },
    SMALL: { name: "Small event", help: "Classes, entries and start times without a draw. For local events and club championships." },
    STANDARD: { name: "Event", help: "Draw, import, speaker and official results. Forked courses give variants and a forking check." },
    FORKED: { name: "Event", help: "Draw, import, speaker and official results. Forked courses give variants and a forking check." },
    RELAY: { name: "Relay", help: "Teams and legs, mass start and restart, team results and speaker." },
    ROGAINING: { name: "Rogaining", help: "Optional controls with points, time limit and penalty. Results by points, then time." },
    PARTY: { name: "Party", help: "Bar desk: guests punch the units for the items themselves and read out their card. Purchases, total per person and export." }
  },
  typeLegend: "Type of event",
  sections: {
    COURSES: "Courses", COURSES_CLASSES: "Courses & classes", CONTROLS_POINTS: "Controls & points", CLASSES: "Classes",
    CLASSES_LEGS: "Classes & legs", ENTRIES: "Entries", PARTICIPANTS: "Participants", TEAMS: "Teams", START: "Start", PUBLISH: "Publish",
    READOUT: "Readout", RESULTS: "Results", PARTY: "Party", SETTINGS: "Settings"
  },
  navigation: "Parts of the event",
  start: "Start",
  speaker: "Speaker",
  openSpeaker: "Open speaker",
  openReadout: "Open readout",
  openPartyDesk: "Open the bar desk",
  newTab: "opens in a new tab",
  attention: "Needs attention",
  liveState: "Right now",
  functionary: "Official",
  live: { readOut: "read out", inForest: "still out", unknown: count => count === 1 ? "unknown card" : "unknown cards" },
  shortcuts: "Shortcuts",
  menu: "Menu",
  settings: {
    title: "Settings",
    help: "Name, date and type. Changing the type only changes which parts are shown; nothing is removed.",
    eventName: "Event name",
    raceName: "Stage/race",
    raceNameHelp: "For example Stage 1 or Thursday. Leave empty if the event only has one race.",
    raceDate: "Date",
    raceDateLocked: "The date cannot be changed once someone has read out or has results.",
    dateMove: {
      help: "The start times move to the new date with the same clock times. You see what happens before it is saved.",
      title: "Move the event",
      summary: (from, to) => `The event moves from ${from} to ${to}. The start times keep their clock times.`,
      startTimes: (count, first, last) =>
        `${plural(count, "runner", "runners")} with start time ${first === last ? first : `${first}–${last}`} get the same time on the new date.`,
      drawClasses: count => count === 1 ? "The draw for 1 class moves along, with vacant times." : `The draw for ${count} classes moves along, with vacant times.`,
      relayLegs: count => count === 1 ? "1 relay leg with mass start or restart moves along." : `${count} relay legs with mass start or restart move along.`,
      after: (firstDay, first, lastDay, last) => firstDay === lastDay
        ? `After the move: ${firstDay} ${first}–${last}.` : `After the move: ${firstDay} ${first} to ${lastDay} ${last}.`,
      republish: "The start list is published. Publish it again under Start once the event has moved.",
      journal: "The move is saved as a single change and appears in the event's history with each runner's old and new time.",
      confirm: "Move the event and the start times",
      cancel: "Cancel",
      saved: date => `The event has moved to ${date} with the same start times.`,
      blockedTitle: date => `The event cannot be moved to ${date}: it has already started.`,
      blocked: { READOUTS: "Someone has read out their card.", PUNCHES: "There are punches from radio controls.",
        CHECKINS: "Someone is checked in at the start.", RESULTS: "There are results." }
    },
    save: "Save settings",
    saved: "The settings are saved.",
    conflict: "The settings could not be saved: something changed in the meantime. Refresh and try again.",
    failed: "The settings could not be saved. Try again.",
    people: {
      title: "People with access",
      help: "Officials reach readout, direct entry of an unknown card, still out, start and speaker. They see the participants' full names and can download the party's purchases as a CSV file. Administrators reach everything. Course setting only gives course setting on this event: edit, suggest changes, or read and comment. The mapper only sees the map and the map errors (no courses or controls, no photos), replies and marks them done; a map error near a control can still reveal it. The access is saved for the email address and applies when the person signs in with that address (with their own account and a confirmed email). With email on the server the person gets an email with a link.",
      loading: "Fetching people …",
      loadError: "The list could not be fetched. Try again.",
      name: "Name",
      email: "Email",
      role: "Role",
      roles: { OWNER: "Owner", ADMIN: "Administrator", FUNCTIONARY: "Official", COURSE_EDIT: "Course setting: edit",
        COURSE_SUGGEST: "Course setting: suggest", COURSE_COMMENT: "Course setting: read and comment",
        COURSE_MAP: "Mapper: only the map and the map errors" },
      you: "you",
      pendingVerification: "waiting for a confirmed email",
      remove: "Remove",
      removeLabel: name => `Remove the access for ${name}`,
      confirmRemove: name => `Remove ${name}'s access? The person loses access immediately.`,
      removed: name => `${name} no longer has access.`,
      addTitle: "Add a person",
      addEmail: "Email address",
      addEmailHelp: "The same address the person signs in with.",
      addRole: "Role",
      add: "Add",
      invited: (email, role) => `The access is saved for ${email} as ${role.toLowerCase()}. It applies when the person signs in with the address.`,
      waitingForLogin: "waiting for the person to sign in with the address",
      already: "The person already has access to the event.",
      ownerOnly: "Only the owner can add and remove administrators.",
      failed: "The change could not be saved. Try again.",
      sessionExpired: "The session has expired. Reload the page and try again."
    },
    publishLink: "Publishing and the event page's address are in the Publish step.",
    publishOpen: "Go to Publish",
    import: "Import",
    importHelp: "Entries and start lists (IOF XML) are imported under Entries. Course files are imported under Courses, and Eventor here under Eventor.",
    importOpen: "Go to Entries"
  }
};

export const raceWorkspaceNavigationEn: Texts<typeof raceWorkspaceNavigationSv> = {
  backToEvents: "My events",
  courseSetting: "Course setting",
  mapErrors: "Map errors",
  courseSettingStatus: { EDIT: "The map, courses and printing", SUGGEST: "You suggest changes", COMMENT: "Read and comment", MAP: "The map errors" },
  checklist: "Checklist",
  steps: { COURSES: "Courses", CLASSES: "Classes", ENTRIES: "Entries", START: "Start", READOUT: "Readout", RESULTS: "Results" },
  staff: "Officials",
  speaker: "Speaker",
  search: "Search name, club, class or card",
  classFilter: "Class",
  rosterOrder: "Order",
  rosterNameOrder: "Last name",
  rosterFixedStartOrder: "Start time",
  rosterFixedStartOrderHelp: "Free start and missing start time last",
  rows: "Rows per page",
  entriesEmpty: "No entries yet.",
  entriesEmptyHelp: "Add the participants one at a time. The form stays between participants.",
  entriesImport: "or import entries",
  entriesImportLink: "Import entries (IOF XML)",
  entriesImportHelp: "From Eventor: Settings → Eventor.",
  selectedHelp: "Choose a participant in the table for details, control times and changes.",
  selectedContext: "Chosen participant outside the visible table page",
  selected: "Chosen",
  selectedOutsideFilters: "outside the current selection",
  selectedOnPage: page => `on page ${page}`,
  revealFilteredSelected: "Clear filters and show the chosen one",
  revealSelectedOnPage: page => `Show the chosen one on page ${page}`,
  participantSequence: "Participants in the current selection",
  previousParticipant: "Previous",
  nextParticipant: "Next",
  participantPosition: (position, total) => `${position} of ${total} in the current selection`,
  participantOutsideSequence: "The chosen participant is outside the current selection"
};

/** Delarnas läge i sidopanelen (`sectionStatus`). */
export const sectionStatusEn: Texts<typeof sectionStatusSv> = {
  noCourses: "No course yet",
  noControls: "No controls yet",
  courses: count => plural(count, "course", "courses"),
  noClasses: "No class yet",
  noClassesPlural: "No classes yet",
  classes: count => plural(count, "class", "classes"),
  noTeams: "No teams yet",
  teams: (teams, runners) => `${plural(teams, "team", "teams")} · ${plural(runners, "runner", "runners")}`,
  noParticipants: "No participants yet",
  participants: count => plural(count, "participant", "participants"),
  noEntries: "No entries yet",
  entries: count => plural(count, "entry", "entries"),
  missingStartTimes: count => `${count} missing a start time`,
  freeStart: "Free start",
  startTimesReady: "Start times ready",
  published: "Published",
  unpublished: "Not published",
  hidden: "Hidden",
  readOut: count => `${count} read out`,
  inForest: count => `${count} still out`,
  unknownCards: count => plural(count, "unknown card", "unknown cards"),
  mispunched: count => `${plural(count, "mispunch", "mispunches")} to look at`,
  noResults: "No results yet",
  results: count => plural(count, "result", "results"),
  party: "Items, purchases and export"
};

/** Toppbalkens knappar (ur `raceAdministratorSv`). */
export const shellEn: { readonly refreshOverview: string; readonly logout: string } = { refreshOverview: "Refresh", logout: "Sign out" };
