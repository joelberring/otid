import type { Texts } from "../lib/language";
import { plural } from "./plural";
import type { rogainingSv } from "./rogaining-sv";
import type { speakerSv } from "./speaker-sv";
import type { radioSv } from "./radio-sv";

/** Engelska, arbetsytan del 8: rogaining och speakersidan. */
const points = (value: number) => `${value} p`;

export const rogainingEn: Texts<typeof rogainingSv> = {
  title: "Controls & points",
  help: "The runner punches optional controls in any order within the time limit. Each control counts once. " +
    "The points default to the control code's tens (31 gives 3 p, 45 gives 4 p, 102 gives 10 p) and can be changed. " +
    "Each started minute over the time limit costs penalty points; the total never goes below 0.",
  loading: "Fetching the controls …",
  noControls: "No controls yet",
  noControlsHelp: "Write the controls and a class with a time limit. The order does not matter; the points can be changed afterwards.",
  addControls: "Add controls and class",
  newCourseTitle: "Controls and class",
  newCourseHelp: "Write the control codes. Fill in a class name if you want to create a class with time limit and penalty straight away.",
  classesTitle: "Classes: time limit and penalty",
  className: "Class",
  timeLimit: "Time limit (min)",
  penalty: "Penalty per started minute",
  timeLimitLabel: className => `Time limit in minutes for ${className}`,
  penaltyLabel: className => `Penalty per started minute for ${className}`,
  notRogaining: "Assessed as an ordinary course until the time limit is saved.",
  controlsTitle: "Points per control",
  controlLabel: code => `Points for control ${code}`,
  pointsInCourseSetting: "The points are set in course setting. Change them there and use Transfer to the event.",
  openCourseSetting: "Open course setting",
  changed: defaultPoints => `changed, default ${defaultPoints}`,
  preview: "Show what happens",
  save: "Save points and time limit",
  saveConfirmed: "Save and recalculate",
  reset: "Undo the changes",
  unchanged: "Nothing has changed.",
  invalid: "Give whole points 0–1000, time limit 1–2880 minutes and penalty 0–1000 points.",
  missingRules: "Give both time limit and penalty for the class.",
  nobodyReadOut: "Nobody in the affected classes has read out. The change is saved directly.",
  noResultChange: count => `${plural(count, "read-out runner is", "read-out runners are")} recalculated. Nobody gets a changed status or total.`,
  changesTitle: count => `${plural(count, "runner gets", "runners get")} a changed result`,
  confirmHelp: "The results are recalculated when you save. The history stays.",
  notRecalculated: count => `${count} with a manually corrected time are not recalculated.`,
  status: { OK: "approved", MP: "mispunched" },
  outcome: (status, total) => total === undefined ? status : `${status}, ${points(total)}`,
  saved: recalculated => recalculated === 0 ? "The points and the time limit are saved."
    : `The points and the time limit are saved. ${plural(recalculated, "result was", "results were")} recalculated.`,
  conflict: "The event has changed in the meantime. The controls are loaded again; look at the message and save again.",
  rejected: "The change could not be saved. Load the page and try again.",
  previewError: "The message could not be fetched. Try again.",
  unknown: "The answer did not arrive. Press Save again; the same change is sent and saved only once.",
  savedLoadError: "The change is saved but the controls could not be loaded again. Refresh the page.",
  courseTimeLimit: "Time limit (min)",
  coursePenalty: "Penalty per started minute",
  courseControlsHelp: "The control codes in any order, with spaces or commas. The points are set under Controls & points."
};

export const speakerEn: Texts<typeof speakerSv> = {
  title: "Speaker",
  updatedAt: time => `Updated ${time}`,
  offline: "No connection – showing the latest fetched",
  stale: "Could not refresh – showing the latest fetched",
  loading: "Fetching the state …",
  loadError: "The state could not be fetched. The page tries again by itself.",
  loginNeeded: "Sign in as organiser to see the speaker page.",
  login: "Sign in",
  back: "Workspace",
  latestTitle: "Latest finishers",
  latestEmpty: "Nobody has finished yet.",
  leadersTitle: "Leaders per class",
  leadersEmpty: "No approved results yet.",
  allClasses: "All classes",
  classFilter: "Class",
  forestTitle: "Still out",
  forestEmpty: "Nobody is still out.",
  forestNotStarted: "The event has not started.",
  forestCount: count => `${count} out`,
  relayTitle: "Teams per leg",
  relayOut: (leg, count) => `Out on leg ${leg}: ${count}`,
  relayFinished: count => `Finished: ${count}`,
  team: (number, name) => `${number} ${name}`,
  relayLeg: (number, name, leg, variant, restarted) =>
    [`Team ${number} ${name}`, `leg ${leg}`, variant ? `variant ${variant}` : "", restarted ? "restart" : ""].filter(Boolean).join(" · "),
  place: position => `${position}.`,
  noTime: "–",
  noResult: "No result",
  statuses: { OK: "Approved", OVERTIME: "Over the maximum time", MP: "Mispunched", DSQ: "Disqualified", OOC: "Out of competition", DNS: "Did not start",
    DNF: "Did not finish", NT: "Took part" }
};

/** Engelska, arbetsytan del 8: radiokontrollerna (inställningar, listorna, Live och speakern). */
export const radioEn: Texts<typeof radioSv> = {
  settings: {
    title: "Radio controls",
    help: "Split times from radio controls in the forest via ROC or OResults. The readout at the finish still decides the result.",
    loading: "Fetching the radio settings …",
    loadError: "The radio settings could not be fetched.",
    retry: "Try again",
    failed: "That did not work. Check the connection and try again.",
    sessionExpired: "The session has expired. Reload the page and sign in again.",
    invalid: "Check the unit's id: only letters, digits, - and _.",
    enabled: "Fetch radio punches",
    enabledHelp: "The server fetches new punches every ten seconds on the race day.",
    source: "Source",
    sources: { ROC: "ROC (roc.olresultat.se)", ORESULTS: "OResults" },
    sourceShort: { ROC: "ROC", ORESULTS: "OResults" },
    unit: "ROC id",
    unitHelp: "The number ROC or OResults shows for your event or unit.",
    controls: "Radio controls",
    controlsHelp: "Tick the controls that send punches. The name is shown in the lists and to the speaker (optional).",
    controlLabel: code => `Control ${code}`,
    controlCourses: courses => courses.join(", "),
    labelFor: code => `Name of control ${code}`,
    labelPlaceholder: "e.g. Radio 1",
    noCandidates: "Add courses first. The radio controls are chosen among the courses' controls.",
    relay: "The relay teams' runners get no split times yet. The punches are saved anyway.",
    save: "Save",
    saved: "The radio settings are saved.",
    fetchNow: "Fetch now",
    fetched: count => count === 0 ? "Fetched. No new punches." : count === 1 ? "Fetched: 1 new punch." : `Fetched: ${count} new punches.`,
    notConfigured: "Save the settings first.",
    polling: {
      OFF: "Switched off. No punches are fetched.",
      TODAY: "Fetches automatically every ten seconds today.",
      NOT_TODAY: date => `Fetches automatically on the race day (${date}). Use Fetch now to try the connection.`
    },
    lastFetch: time => `Latest successful fetch ${time}`,
    neverFetched: "Nothing fetched yet.",
    counts: (punches, unknown, other) =>
      [plural(punches, "punch", "punches"), `${unknown} with unknown card`, ...(other > 0 ? [`${other} at other controls`] : [])].join(" · "),
    malformed: count => `${plural(count, "row", "rows")} from the service could not be read and were skipped.`,
    lastError: (time, text) => `Error ${time}: ${text}`,
    retrying: failures => failures > 1 ? `${failures} attempts in a row have failed. The server tries again with longer gaps.` : "",
    errors: {
      INVALID_INPUT: () => "The unit's id or the server's radio setting is wrong.",
      INVALID_RESPONSE: source => `The answer from ${source} was not punches. Check the unit's id.`,
      UPSTREAM_UNAVAILABLE: source => `${source} is not answering right now. The server tries again.`,
      REJECTED: source => `${source} refused the request.`,
      NOT_FOUND: source => `${source} did not find the unit. Check the unit's id and the source.`,
      RESPONSE_TOO_LARGE: source => `The answer from ${source} was too large.`,
      TIMEOUT: source => `${source} did not answer in time. The server tries again.`
    },
    latestTitle: "Latest radio punches",
    unknownCard: card => `Unknown card ${card}`,
    latestRow: (time, control) => `${time} · ${control}`
  },
  live: {
    title: "At radio control",
    onTheWayTitle: "Out in the forest",
    onTheWayHelp: "Passed a radio control but not read out. The place is preliminary.",
    passed: control => `passed ${control}`,
    passedAt: (control, time) => `passed ${control} ${time}`,
    clock: time => `at ${time}`,
    place: place => `(${place})`,
    placeLabel: place => `place ${place} at the control`,
    finished: "finished",
    noneFinished: "Nobody has read out yet",
    leader: (name, time) => `Leader: ${name} ${time}`,
    controlHeading: (control, count) => `${control} · ${count} passed`,
    noTime: "–",
    name: "Name",
    time: "Time",
    placeColumn: "Pl."
  },
  speaker: {
    latestTitle: "Latest radio punches",
    latestEmpty: "No radio punches yet.",
    leadersTitle: control => `Leaders at ${control}`,
    onTheWay: "on the way in"
  },
  hub: {
    title: "Radio controls live",
    help: "Split times from the forest in the results list."
  }
};

/** Namnet på en radiokontroll på engelska: det valda namnet, annars "control 31". */
export function radioControlNameEn(code: number, label: string | null, capital = false): string {
  return label ?? `${capital ? "C" : "c"}ontrol ${code}`;
}
