import type { Texts } from "../lib/language";
import { formatDuration } from "../lib/clock-time";
import { plural } from "./plural";
import type { courseSecrecySv } from "./course-secrecy-sv";
import type { readoutRereadSv } from "./readout-reread-sv";
import type { decisionReviewSv } from "./decision-review-sv";
import type { uninterpretedReadoutsSv } from "./uninterpreted-readouts-sv";
import type { publicLinkShareSv } from "./public-link-share-sv";
import type { manualResultSv } from "./manual-result-sv";
import type { correctionSv } from "./correction-sv";
import type { checkinHistorySv } from "./checkin-history-sv";
import type { checkinConflictReviewSv } from "./checkin-conflict-review-sv";
import type { formErrorsSv } from "./form-errors-sv";
import type { raceWorkflowDetailSv } from "./race-workflow-detail-sv";
import type { startDrawAdvancedSv } from "./start-draw-advanced-sv";
import type { raceBackupSv } from "./race-backup-sv";
import type { controlMapSv } from "./control-map-sv";
import type { stationsSv } from "./stations-sv";
import type { raceMapSv } from "./race-map-sv";
import type { mapBundlesSv } from "./map-bundles-sv";
import { startRuleEn as rule } from "./workspace-admin-en";

/** Engelska, arbetsytan del 11: de mindre delarna (banhemlighet, omläsning, beslut, otolkade, manuell tid, Rätta, fältfel …). */
export const courseSecrecyEn: Texts<typeof courseSecrecySv> = {
  title: "The courses publicly",
  help: "Publicly, the forkings, the control locations and the control map show only when everyone has finished (or got did not start or another decision), when the results are ready or when you choose to show them. The split times show all the time. You choose the variant letter and the map under Before the start. You and the officials always see everything.",
  secret: remaining => remaining === 1 ? "The courses are secret publicly. 1 runner has no result yet."
    : `The courses are secret publicly. ${remaining} runners have no result yet.`,
  secretEmpty: "The courses are secret publicly. There are no entries yet.",
  reason: {
    ALL_FINISHED: "The courses show publicly: everyone has a result.",
    FINALIZED: "The courses show publicly: the results are ready.",
    REVEALED: "The courses show publicly: you have chosen to show them."
  },
  reveal: "Show the courses publicly now",
  withdraw: "Hide the courses again",
  withdrawNote: "The courses are hidden again until everyone has finished or the results are ready.",
  revealedNow: "The courses now show publicly.",
  withdrawnNow: "Your choice is undone.",
  failed: "Could not change. Try again.",
  timing: {
    title: "Before the start",
    help: "The variant letter (AC, BD …) and the map often reveal the course. By default they show publicly only after the start: the variant when the runner has started, the map when the event has started (the first start has passed or something has been read out). When the courses are public both show.",
    variant: "The variant letter publicly",
    variantAfterStart: "When the runner has started (default)",
    variantAlways: "Directly, also before the start",
    map: "The map publicly",
    mapAfterStart: "When the event has started (default)",
    mapOnPublish: "Directly when the event is published",
    saved: "Saved.",
    failed: "Could not save. Try again."
  }
};

type Status = "OK" | "OVERTIME" | "MP" | "UNKNOWN_CARD";
type ManualDecision = keyof typeof readoutRereadSv.decisions;
const status: Record<Status, string> = { OK: "Approved", OVERTIME: "Maximum time", MP: "Mispunched", UNKNOWN_CARD: "Unknown card" };
const decisions: Record<ManualDecision, string> = { DSQ: "The disqualification", APPROVAL: "The manual approval", DNF: "Did not finish",
  OOC: "Out of competition", NT: "Without timing", FINISH_TIME: "The corrected finish time", START_TIME: "The corrected start time",
  MANUAL_TIME: "The manual time", CONTROL_APPROVAL: "The approved controls", MP_CONFIRMED: "The confirmed mispunch" };
const withdrawals: Record<ManualDecision, string> = { DSQ: "Remove disqualification", APPROVAL: "Remove manual approval", DNF: "Remove did not finish",
  OOC: "Remove out of competition", NT: "Remove without timing", FINISH_TIME: "Remove manual time", START_TIME: "Remove manual time",
  MANUAL_TIME: "Remove manual time", CONTROL_APPROVAL: "Remove approved controls", MP_CONFIRMED: "Remove the confirmation" };

export const readoutRereadEn: Texts<typeof readoutRereadSv> = {
  title: "Re-read readouts from raw data",
  help: "Reads every saved readout again from the card's raw data with the current readout, with the same clock as when the card was read. Only those that become different are shown. The old readout is always kept.",
  show: "Show what happens",
  confirm: "Save and recalculate",
  cancel: "Cancel",
  retry: "Try again",
  checked: count => `${plural(count, "readout was", "readouts were")} re-read.`,
  noChanges: "No readout becomes different.",
  changes: count => `${plural(count, "readout becomes", "readouts become")} different:`,
  choose: "Re-read",
  side: (count, value, elapsedMs) => `${plural(count, "punch", "punches")}, ${status[value]}${elapsedMs !== null ? ` ${formatDuration(elapsedMs)}` : ""}`,
  card: cardNumber => `Card ${cardNumber}`,
  manual: decision => `${decisions[decision]} still applies. Remove it with "${withdrawals[decision]}" in the participant card if the re-read should apply.`,
  decisions,
  withdrawals,
  unreadableTitle: "Cannot be re-read",
  unreadable: (cardNumber, name, detail) => `Card ${cardNumber} · ${name}: ${detail}`,
  unreadableReasons: { FRAMES: "the raw data cannot be decoded", TIME: "the times cannot be placed", PAYLOAD: "raw data is missing" },
  notSaved: "Nothing is saved yet.",
  noneChosen: "Choose at least one readout.",
  saved: count => `Saved. ${plural(count, "readout was", "readouts were")} re-read and recalculated.`,
  conflict: "Something has changed since you pressed Show what happens. Show again.",
  invalid: "The request could not be interpreted. Show again.",
  unreachable: "The server is not answering. Nothing is confirmed saved; try again.",
  cardRow: "The readout can be re-read from raw data",
  cardReview: "Re-read the readout"
};

export const decisionReviewEn: Texts<typeof decisionReviewSv> = {
  decisions: { DSQ: "Disqualified", APPROVAL: "Approved manually", DNF: "Did not finish", OOC: "Out of competition", NT: "Took part without time",
    FINISH_TIME: "Corrected finish time", START_TIME: "Corrected start time", MANUAL_TIME: "Manual time", CONTROL_APPROVAL: "Approved controls",
    MP_CONFIRMED: "Confirmed mispunch" },
  statuses: { OK: "Approved", MP: "Mispunched", OVERTIME: "Over the maximum time" },
  message: (readout, decision) => `The readout gives ${readout} but the decision ${decision} applies.`,
  help: "Remove the decision if the readout should apply. Otherwise you can leave it.",
  remove: "Remove the decision",
  listTitle: "Decisions to review",
  listHelp: "A decision applies, but a later readout gives something else. Open the runner and remove the decision if the readout should apply.",
  listEmpty: "No decisions to review.",
  open: "Open"
};

export const uninterpretedReadoutsEn: Texts<typeof uninterpretedReadoutsSv> = {
  title: "Uninterpreted readouts",
  help: "Cards whose times could not be interpreted at the readout. The raw frames are saved. Re-read with the computer's clock, or give when the card was read out if the computer's clock was wrong. An unknown card then ends up under Unknown cards.",
  load: "Show uninterpreted readouts",
  none: "No uninterpreted readouts.",
  row: (card, time, error) => `Card ${card} at ${time} (${error})`,
  exercise: "practice",
  rereadDevice: "Re-read with the computer's clock",
  givenDate: "Date",
  givenTime: "Clock time when the card was read out",
  rereadGiven: "Re-read with the given time",
  invalidTime: "Write the clock time as 18:45.",
  read: (value, punches) => `Re-read: ${value}, ${plural(punches, "punch", "punches")}.`,
  alreadyRead: value => `Re-read: ${value}.`,
  unreadable: detail => `Still could not be interpreted (${detail}). Try a given time.`,
  conflict: "The readout is already re-read. Show the list again.",
  invalid: "The readout no longer exists. Show the list again.",
  unreachable: "The server is not answering. Nothing is confirmed saved; try again.",
  loadError: "The list could not be read.",
  status: { OK: "Approved", OVERTIME: "Maximum time", MP: "Mispunched", UNKNOWN_CARD: "Unknown card" }
};

export const publicLinkShareEn: Texts<typeof publicLinkShareSv> = {
  title: "Share public link",
  share: "Share link",
  copy: "Copy link",
  shared: "The link has been opened for sharing.",
  shareCancelled: "The sharing was cancelled. You can copy the link instead.",
  copied: "The link is copied.",
  copyUnavailable: "The link could not be copied. Copy the address from the browser."
};

export const manualResultEn: Texts<typeof manualResultSv> = {
  manualTimeOpen: "Enter time manually",
  manualTimeTitle: "Enter time manually",
  manualTimeHelp: "When the finish punch or start is missing, the clock was wrong for the runner or the card is lost or broken. " +
    "The result is placed in the results list and marked as manual time. It can be removed under Change status.",
  noReadoutHelp: "The runner has no readout. The time becomes the whole result.",
  finishClock: "Finish time (clock, e.g. 19:42:10)",
  startClock: "Start time (clock)",
  startKnown: clock => `Start time ${clock} (leave empty to keep it)`,
  elapsed: "or running time (e.g. 42:10 or 1:02:10)",
  status: "Status",
  statusOk: "Approved",
  statusMp: "Mispunched",
  reason: "Reason (required)",
  reasonSuggestions: ["Forgot to punch finish", "Lost the card", "Broken card", "Wrong time in the station", "Start missing"],
  preview: (elapsed, value) => `Running time ${elapsed}, ${value.toLocaleLowerCase("en-GB")}.`,
  save: "Save manual time",
  cancel: "Cancel",
  retry: "Try again",
  saved: "The manual time is saved.",
  approvalSaved: "The controls are approved.",
  conflict: "It did not work: the result has changed or the times do not add up. Check and try again.",
  unknown: "Could not reach the server. Try again – the same change is sent again.",
  loadError: "The runner's state could not be read. Try again.",
  needFinish: "Give finish time or running time.",
  needStart: "Give start time (the runner has no known start).",
  badClock: "Write the clock time as 19:42 or 19:42:10.",
  badElapsed: "Write the running time as 42:10 or 1:02:10.",
  reasonRequired: "Write a reason.",
  notReady: "Time cannot be entered manually now. First remove the decision that applies (Change status).",
  approveOpen: "Approve missing controls",
  approveTitle: "Approve missing controls",
  approveHelp: "Tick the controls the runner demonstrably visited. If nothing missing remains, the runner becomes approved with their time.",
  approveControl: code => `Control ${code}`,
  approveReasonSuggestions: ["Punched with the pin", "The station did not register", "The control was out of order"],
  approveSave: "Approve chosen controls",
  approveNone: "Choose at least one control.",
  approveResult: remaining => remaining === 0 ? "Nothing is missing afterwards: the runner becomes approved with their time."
    : `${plural(remaining, "control is", "controls are")} still missing: the runner is still mispunched.`
};

export const correctionEn: Texts<typeof correctionSv> = {
  title: "Correct",
  help: "Everything that changes the runner's result: status, time, controls, course, variant and card. Each correction is saved in the history and can be removed again.",
  status: "Status",
  timeAndControls: "Time and controls",
  courseAndCard: "Course and card",
  courseAndCardHelp: "Change card moves the readout to the right runner. Change class recalculates the result on the new course.",
  changeCard: "Change card",
  changeClass: "Change class",
  more: "More",
  moreHelp: "Correct a single punched finish or start time without changing the rest of the readout, and remove such a correction.",
  shortcutTitle: "Correct a runner",
  shortcutHelp: "Status, manual time, approved controls, course, variant and card are corrected in the runner's participant card under Correct.",
  shortcutChoose: "Runner",
  shortcutPlaceholder: "Choose runner …",
  shortcutOpen: "Open Correct",
  readoutMore: "More: tools for the whole event",
  readoutMoreHelp: "Start and return history, corrections that apply to all runners, re-reading from raw data and readouts that could not be interpreted."
};

export const checkinHistoryEn: Texts<typeof checkinHistorySv> = {
  title: "Start and return history",
  timeZone: "Time zone",
  help: "Journal stored on the server, latest received first. Unsynced mobile information may be missing. Times show observation and receipt, not the start punch. At most 25 rows per page.",
  latest: "Show the latest journal", older: "Show older journal rows", empty: "No journalled check-ins.",
  error: "The journal could not be fetched. Try again.", choose: "Choose a participant in the participant list.",
  observed: "Observed", received: "Received", source: "Source", action: "Information", effect: "Effect",
  roles: { ADMIN: "Administrator", FUNCTIONARY: "Official" },
  states: { UNMARKED: "Unknown start", STARTED: "Started", REPORTED_NOT_STARTED: "Reported did not start" },
  returned: "Manual return: yes", notReturned: "Manual return: no",
  effects: { APPLIED: "Applied", UNCHANGED: "Unchanged", CONFLICT: "Conflict – not applied" }, reviewed: "Reviewed", reviewedAt: "Reviewed",
  reasons: { STALE_ENTRY: "Participant changed", STALE_PACKAGE: "Event changed", STALE_REVISION: "A newer check-in exists",
    DEPENDENCY_CONFLICT: "Earlier request in conflict", RETURN_ALREADY_REGISTERED: "Return exists", RESULT_CONFLICT: "Conflicting result" }
};

export const checkinConflictReviewEn: Texts<typeof checkinConflictReviewSv> = {
  title: "Review received conflict reports",
  adminHelp: "The review keeps registered information and history. It does not register a return and changes no results. Correct wrong information separately before the review.",
  help: "Online decision for finish staff. The review keeps the registered state and history; it does not register a return and changes no results. Correct wrong information separately before the review.",
  entry: "Participants with unreviewed reports", choose: "Choose participant", load: "Show the reports",
  current: "Current registered information", reports: "Received but not applied reports",
  noReports: "There are no unreviewed reports. Conflicting information is still corrected in still out.",
  generated: "Information fetched", observed: "Reported on the unit", received: "Received",
  mark: "Start mark", correction: "Finish correction", returnYes: "Manual return: yes", returnNo: "Manual return: no",
  reason: "Reason for the review decision", confirm: "I have checked the reports and want to keep the current registered information.",
  submit: "Confirm review – keep registered state", retry: "Try again",
  pending: "Could not reach the server. Try again – the same decision is sent again.",
  stale: "The reports have changed in the meantime. Show them again before you decide.",
  failedRead: "The reports could not be fetched. Check the connection and try again.",
  tooLarge: "There are too many reports to review at once. Nothing has been saved.",
  saved: "The review is saved. The still-out list is refreshed; follow-up may still be needed.",
  errors: {
    STALE_ENTRY: "The participant details had changed", STALE_PACKAGE: "The event had changed",
    STALE_REVISION: "A newer start record existed", DEPENDENCY_CONFLICT: "A preceding local report could not be applied",
    RETURN_ALREADY_REGISTERED: "A return was already registered", RESULT_CONFLICT: "The report contradicted the result"
  }
};

export const formErrorsEn: Texts<typeof formErrorsSv> = {
  eventName: "Write the event's name (at least 2 characters).",
  stageName: "The stage or race name may be at most 160 characters. Leave empty if not needed.",
  raceDate: "Write the event's date as YYYY-MM-DD, for example 2026-10-25.",
  timeZone: "Write a time zone, for example Europe/Stockholm.",
  courseName: "Write the course's name.",
  className: "Write the class's name.",
  controls: "Write the controls in order, for example 31 32 33.",
  controlsInvalid: "The control codes must be positive whole numbers, for example 31 32 33.",
  timeLimit: "Write the time limit in minutes (1–2 880).",
  penalty: "Write the penalty in points per started minute (0–1 000).",
  chooseCourse: "Choose which course the class runs.",
  chooseClass: "Choose class.",
  classFull: "The class is full. Choose another class or raise the maximum under Classes.",
  givenName: "Write the first name.",
  familyName: "Write the last name.",
  card: "The card number should be digits only, without a leading zero.",
  startTime: "Write the start time as a clock time, for example 18:30.",
  firstStart: "Give the first start as a clock time, for example 10:00.",
  email: "Write an email address, for example name@club.org.",
  tooLong: max => `At most ${max} characters.`
};

export const raceWorkflowDetailEn: Texts<typeof raceWorkflowDetailSv> = {
  free: rule.rules.PUNCH,
  factsTitle: "Participant details",
  name: "Name",
  club: "Club",
  class: "Class",
  card: "Card",
  noCard: "No card",
  multipleCards: "Several cards linked · check",
  cardRental: "Rental card",
  returned: "Returned",
  notReturned: "Not returned",
  startTime: "Start time",
  noFixedTime: rule.noStartTime,
  editActions: "Change participant details",
  editIdentity: "Change name or club",
  editTransfer: "Change class",
  editCard: "Change card",
  editTime: "Change start time",
  shortIdentity: "Name / club",
  shortTransfer: "Change class",
  shortCard: "Card",
  shortTime: "Start time",
  resultTitle: "Split times",
  historical: "Shows the course the result was assessed against.",
  resultError: "The result details could not be fetched.",
  noActiveResult: "There is no result to show.",
  missingDetails: "The split times do not exist for this result.",
  loading: "Loading the split times …",
  noSplitsWithoutStartFinish: "No split times: the card has no start or finish punch.",
  noTechnicalDetails: "The result is set by hand and has no split times.",
  resultClass: "Class",
  course: "Course",
  startRecorded: "Start",
  finishRecorded: "Finish",
  order: "No",
  control: "Control",
  leg: "Leg",
  cumulative: "Cumulative time",
  occurrence: "occurrence",
  noSplit: "No split time",
  outOfOrder: "Out of order",
  notRecorded: "Not given",
  unknownTime: "Unknown time",
  missingControls: "Missing controls",
  untimedControls: codes => `Punched without a valid time: ${codes}. The punch is before the start or after the finish, so the split time is unknown. Check the runner's start time and the unit's clock.`,
  extraPunches: "Extra punches",
  none: "None"
};

const and = (list: readonly string[]) => list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
const minutesEn = (count: number) => plural(count, "minute", "minutes");

/** Engelska, arbetsytan del 12: lottningens Avancerat. */
export const startDrawAdvancedEn: Texts<typeof startDrawAdvancedSv> = {
  title: "Advanced",
  changed: "settings changed",
  help: "The settings are saved with the draw and stay for next time. Classes that are not ticked keep their times; the new times are placed around them.",
  selectAll: "Tick all classes", selectUndrawn: "Tick classes without start times",
  rulesHeading: "Rules for the whole start",
  groupControls: "Start group is decided by the first",
  groupControlsOptions: { "1": "1 control", "2": "2 controls", "3": "3 controls" },
  groupControlsHelp: "Classes whose courses begin with the same controls never start the same minute. A forked class counts to the group if any of its variants begins the same way.",
  maxPerMinute: "Max starts per minute (total)",
  maxPerMinutePerPen: "Max starts per minute and start pen",
  limitHelp: "Leave empty for no limit. Vacant times count; a mass start counts as one start.",
  penHelpSingle: "With one control each pen starts one class at a time. The limit per pen applies when more controls decide the start group.",
  penHelp: "Start pen = classes whose courses have the same first control.",
  lastStart: "Last start (clock, optional)",
  lastStartHelp: "The preview warns if the starts do not fit.",
  orderHeading: "Start order and later start",
  orderHelp: "The classes are drawn in this order: higher up starts earlier in its start group. A class with a later start is placed first at its time and the others fill around it.",
  orderAutomatic: "Automatic order: mass start first, then the largest class.",
  orderCustom: "Own order.",
  orderReset: "Use automatic order",
  position: "Order", className: "Class", firstStart: "First start",
  moveUp: className => `Move ${className} up`, moveDown: className => `Move ${className} down`,
  laterKind: className => `First start ${className}`,
  laterValue: className => `Time for first start ${className}`,
  laterKinds: { NONE: "With the others", CLOCK: "Clock time", OFFSET: "Minutes after first start" },
  laterPlaceholder: { CLOCK: "10:30", OFFSET: "60" },
  notDrawn: "Not ticked",
  seedingHeading: "Seeding",
  seedingHelp: "Seeded runners are drawn after the others in the class; 1 is best and starts last. The others are drawn freely before.",
  seeding: "Seeded are drawn", seedingOptions: { LAST: "Last in the class (best last)", SPREAD: "Evenly spread (best last)" },
  seedClass: "Show runners in the class",
  seedRank: "Seeding (1 = best)",
  seedLabel: name => `Seeding ${name}`,
  seededCount: count => `${count} seeded`,
  noEntries: "No entries in the class.",
  name: "Name", club: "Club", card: "Card", none: "–",
  importLabel: "Import ranking (CSV)",
  importHelp: "One row per runner: place and name, preferably club and card (for example Place;Name;Club;Card). The runners are matched by card, otherwise by name and club.",
  imported: count => `${plural(count, "runner", "runners")} got seeding from the file.`,
  importUnmatched: count => count === 1 ? "1 row matched no entry:" : `${count} rows matched no entry:`,
  importLine: (line, text) => `row ${line}: ${text}`,
  importError: "The file could not be read. Save it as CSV (semicolon or comma) and try again.",
  clearSeeds: "Remove the seeding in the class",
  errors: {
    limit: "Write a whole number 1–1000 or leave empty.",
    lastStart: "Write the last start as a clock time, for example 12:00, or leave empty.",
    lastStartBefore: "The last start cannot be before the first start.",
    clock: "Write a clock time, for example 10:30, after the first start.",
    offset: "Write minutes after the first start, 1–1440.",
    seed: "Write a whole number 1–10000 or leave empty.",
    summary: "Correct the fields under Advanced."
  },
  warningsTitle: "Rules that cannot be kept",
  afterLastStart: (classNames, lastStart, firstAfter, needed) =>
    `The start window is not enough: ${and(classNames)} get starts after the last start ${lastStart} (from ${firstAfter}). The last start needs to be ${needed}, or raise the max starts per minute.`,
  laterMoved: (className, wanted, actual) => `${className} cannot start ${wanted} without a clash and starts ${actual}.`,
  existingOverLimit: (scope, limit, first, count) =>
    `Existing times already have more than ${limit} ${scope === "TOTAL" ? "starts per minute" : "starts per minute in a start pen"} (${minutesEn(count)}, first ${first}).`,
  existingClash: (classNames, first, count) => `${and(classNames)} already have times in the same start group the same minute (${minutesEn(count)}, first ${first}).`,
  existingTitle: "Keep their times",
  existingClass: (className, count, first, last) => `${className} (${plural(count, "start", "starts")} ${first === last ? first : `${first}–${last}`})`,
  timelineTitle: "Minute by minute",
  timelineHelp: "Where the new times end up among the existing ones. New times are marked New.",
  timelineTime: "Minute", timelineStarts: "Starts",
  newTag: "New",
  startCount: count => count === 1 ? "" : ` ×${count}`,
  seededSlot: rank => `seeded ${rank}`,
  sameControls: (classNames, codes) => `${and(classNames)} begin with the same controls (${codes.join(", ")}) and never start the same minute.`
};

const dateTimeEn = (value: Date) => value.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" });
const sizeEn = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} kB`
  : `${(bytes / 1024 / 1024).toLocaleString("en-GB", { maximumFractionDigits: 1 })} MB`;

/** Engelska, arbetsytan del 12: säkerhetskopian och återställningen. */
export const raceBackupEn: Texts<typeof raceBackupSv> = {
  title: "Backup",
  help: "A file with everything about the event: courses, map file, classes, participants, cards, start times, readouts, results and history. " +
    "If the server breaks, the file can be restored as a new event, also on another server.",
  when: "Take a copy after the draw, one before the start and one after the last finisher.",
  personalDataTitle: "The file contains personal data.",
  personalData: "Names, clubs, card numbers, results and email for those with access. Store it where only the organisers can reach " +
    "it and delete it when it is not needed. You are responsible for the copies on your computer. Accounts, passwords and the Eventor key are not included.",
  action: "Download backup",
  downloaded: "The backup is downloaded.",
  error: "The backup could not be created. Try again.",
  last: at => `Last downloaded ${dateTimeEn(at)}.`,
  never: "No backup has been downloaded yet.",
  restoreHint: "Restore under My events → Restore event from backup.",
  restore: {
    open: "Restore event from backup",
    openHint: "Has the server broken? Import a backup as a new event.",
    title: "Restore event from backup",
    intro: "Choose the file (otid-sakerhetskopia-….zip). It is checked first and shown before anything is saved. " +
      "The event becomes a new event; no existing event changes.",
    file: "Backup",
    check: "Check the file",
    checking: "Checking …",
    previewTitle: "This becomes a new event",
    createdAt: at => `The copy was taken ${dateTimeEn(at)}`,
    formatVersion: version => `format version ${version}`,
    size: bytes => sizeEn(bytes),
    counts: counts => [
      plural(counts.classes, "class", "classes"), plural(counts.entries, "participant", "participants"),
      plural(counts.cardReadouts, "readout", "readouts"), plural(counts.resultRevisions, "result row", "result rows"),
      ...(counts.teams > 0 ? [plural(counts.teams, "team", "teams")] : []), plural(counts.files, "file", "files")
    ].join(" · "),
    map: "The map comes along.",
    stale: count => `${plural(count, "result", "results")} needed recalculation when the copy was taken and are marked so in the ` +
      "new event too. Recalculate them after the restore.",
    eventor: "The Eventor link comes along without the club's key. Paste the key under Settings → Eventor.",
    radio: "The radio controls are switched off until you switch them on under Settings.",
    unpublished: "The new event is unpublished and gets its own short address. Publish it when you have checked it.",
    peopleTitle: "People with access",
    peopleLink: "Invite them with the same roles (they get an email and the access when they sign in with the address)",
    peopleSkip: "Only I get access",
    peopleNone: "The copy has no other people with access.",
    roles: { ADMIN: "administrator", FUNCTIONARY: "official", COURSE_EDIT: "course setting", COURSE_SUGGEST: "course setting (suggest)",
      COURSE_COMMENT: "course setting (comment)", COURSE_MAP: "mapper" },
    fromClub: "A person from the club (the address does not come along and gets no access here)",
    personalData: "The file contains personal data. The new event gets the same data as the copy.",
    submit: "Create the event",
    restoring: "Restoring …",
    cancel: "Cancel",
    close: "Close",
    restored: "The event is restored.",
    invited: count => `${plural(count, "invitation has", "invitations have")} been created. The access applies when the person signs in ` +
      "with the address. You see the invitations under People with access.",
    openRace: "Open the event",
    opening: "Opening …",
    problems: {
      NOT_A_BACKUP: () => "The file is not a backup from O-Tid. Choose the file called otid-sakerhetskopia-….zip.",
      OLD_EXPORT: () => "The file is the old export (format version 1), which cannot be imported. Download a backup again from the event.",
      UNKNOWN_FORMAT_VERSION: detail => `The backup has format version ${detail ?? "?"}, which this server cannot read ` +
        "(it reads version 2). It was probably made with a newer version of O-Tid: update the server and try again.",
      TOO_LARGE: () => "The file is too large (at most 200 MB).",
      BROKEN_ARCHIVE: detail => `The file is broken${detail ? ` (${detail})` : ""}. Download the backup again.`,
      CHECKSUM_MISMATCH: detail => `The file has changed or is incomplete${detail ? ` (${detail})` : ""}: the checksum does not match.`,
      UNKNOWN_CONTENT: detail => "The backup contains something this version of O-Tid does not know" +
        `${detail ? ` (${detail})` : ""}. It was probably made with a newer version: update the server and try again.`,
      INVALID_CONTENT: detail => `The backup has an error${detail ? ` in ${detail}` : ""} and cannot be imported.`,
      DATA_REJECTED: detail => `The database did not accept the content${detail ? ` (${detail})` : ""}. Nothing has been saved.`,
      STORAGE_QUOTA_EXCEEDED: detail => `The map in the backup does not fit${detail ? ` (${detail})` : ""}. Remove maps in ` +
        "events no longer used, or ask the server's owner to raise the limit. Nothing has been saved."
    },
    errors: {
      session: "You are no longer signed in. Sign in and try again.",
      conflict: "The attempt concerned another file or another choice. Choose the file again.",
      network: "No contact with the server. Check the network and try again; the same attempt never creates two events.",
      generic: status => `It did not work (error ${status}). Try again.`
    }
  }
};

const placeEn = (value: number | "S" | "M") => value === "S" ? "start" : value === "M" ? "finish" : String(value);

/** Engelska, arbetsytan del 12: kontrollkartan (arbetsytan, deltagarkortet och den publika deltagarsidan). */
export const controlMapEn: Texts<typeof controlMapSv> = {
  open: "Control map",
  openLabel: "Open the control map",
  title: "Control map",
  close: "Close",
  loading: "Fetching the control map …",
  failed: "The control map could not be fetched. Try again.",
  retry: "Try again",
  mode: "Show",
  modeLoad: "Load",
  modeCourse: "Course",
  course: "Course",
  variant: "Variant",
  allVariants: "All variants",
  variantOption: (code, entries) => `${code} (${plural(entries, "entry", "entries")})`,
  metric: "Load by",
  metricPlanned: "Planned runners",
  metricPunched: "Punches",
  mapLabel: "Control map with controls, start and finish",
  courseMapLabel: course => `Control map: ${course}`,
  noPositions: "The course file has no positions for the controls, so the map cannot be drawn. Import a course file with coordinates (IOF XML from OCAD or Purple Pen) to see the controls on the map.",
  missingPositions: count => count === 1 ? "1 control has no position and is only in the table." : `${count} controls have no position and are only in the table.`,
  paperNoScale: "The positions come from the map in the course file without scale; the distances are approximate.",
  noMapImage: "No map under the controls yet. Upload the map file (OCAD or Mapper) or a map image under Results → Map and route choice.",
  mapFileMismatch: "The course file does not seem to be made on this map. The controls are placed with the coordinates in the course file instead.",
  scale: meters => meters >= 1000 ? `${meters / 1000} km` : `${meters} m`,
  start: "Start",
  finish: "Finish",
  control: code => `Control ${code}`,
  outOfOrder: "out of order",
  legend: "Larger and darker ring = more runners. The numbers are also in the table.",
  levels: ["None", "Low", "Medium", "High"],
  table: {
    caption: "Load per control",
    code: "Control",
    courses: "Courses",
    variants: "Variants",
    planned: "Planned",
    punched: "Punches",
    level: "Level",
    status: "State"
  },
  courseControls: "Controls in order",
  variantControls: code => `Variant ${code}`,
  showOnMap: "Show on the map",
  hideMap: "Hide the map",
  runnerMapLabel: name => `Map: ${name}'s course with the punches`,
  leg: leg => `Leg ${leg}`,
  noReadout: "No readout yet; the course is shown without punches.",
  allPunched: "All controls are punched.",
  missing: (code, previous, next) => `Control ${code} is missing, between ${placeEn(previous)} and ${placeEn(next)}.`,
  wrongOrder: (code, previous, next) => `Control ${code} is punched in the wrong order (should be between ${placeEn(previous)} and ${placeEn(next)}).`,
  neutral: code => `Control ${code} is out of order and not needed.`,
  marks: { OK: "Punched", MISSING: "Missing", WRONG_ORDER: "Wrong order", NEUTRAL: "Out of order" },
  legendRunner: "Green ring = punched, red dashed = missing, orange = wrong order.",
  courseOnly: "The controls in order:"
};

/** Engelska, arbetsytan del 12: läsa ut och ställa in enheter. */
export const stationsEn: Texts<typeof stationsSv> = {
  title: "Read out units",
  back: "To the event",
  trial: "Being tested: the readout is built from open descriptions of the protocol but not tried against real units yet. "
    + "Nothing is written to the unit. Download the raw log and send it if something looks wrong.",
  howTo: "Connect a master station (BSM7/BSM8) by USB. Put it in remote mode or let O-Tid do it, place the unit against the master station and press Read out. "
    + "The master station is set back to direct mode afterwards.",
  serialUnsupported: "The browser cannot reach the station. Use Chrome or Edge on a computer.",
  connect: "Connect master station",
  connected: "The master station is connected.",
  disconnect: "Disconnect",
  remote: "Read the unit lying against the master station (remote)",
  direct: "Read the master station itself",
  read: "Read out",
  reading: (done, total) => total ? `Reading the backup memory: ${done} of ${total} …` : "Reading …",
  problems: {
    "no-station": "No unit answered. Place the unit against the master station (or wake it with a card) and try again.",
    timeout: "The unit stopped answering. Try again.",
    nak: "The unit refused the reading.",
    unexpected: "The unit answered unexpectedly. Download the raw log.",
    transport: "The contact with the master station was lost.",
    open: "The port could not be opened. Close other tabs using the station.",
    "invalid-plan": "Choose what to set (the code 1–511)."
  },
  facts: {
    serial: "Serial number", model: "Model", firmware: "Firmware", code: "Code", mode: "Mode", battery: "Battery changed",
    capacity: "Battery capacity (raw value)", memory: "Backup memory", clock: "Clock",
    clockDiff: seconds => Math.abs(seconds) < 2 ? "matches the computer" : `${seconds > 0 ? "ahead of" : "behind"} the computer by ${Math.abs(Math.round(seconds))} s`,
    memoryValue: (kb, count, overflow) => `${kb} kB, ${plural(count, "punch", "punches")}${overflow ? " (the memory has wrapped around)" : ""}`
  },
  modes: { CONTROL: "Control", START: "Start", FINISH: "Finish", READOUT: "Readout", CLEAR: "Clear", CHECK: "Check",
    BEACON_CONTROL: "Control (Air+)", BEACON_START: "Start (Air+)", BEACON_FINISH: "Finish (Air+)" },
  punches: "Punches in the backup memory",
  truncated: "Only the latest 4,000 punches are shown.",
  none: "No punches.",
  card: "Card", time: "Time (12 h)", runner: "Runner", unknownCard: "Not in the event",
  controlInRace: (code, used) => used ? `Code ${code} is on the event's courses.` : `Code ${code} is not on the event's courses.`,
  csv: "Download the punches (CSV)",
  rawLog: "Download raw log",
  noPackage: "The event's participants could not be fetched; the cards are shown without names.",
  write: {
    title: "Set up the unit",
    help: "The clock from the computer, the code and the mode. Nothing else changes; the backup memory is not touched. Afterwards the unit is read again so that you see that the change went through.",
    time: "Set the clock from the computer",
    code: "Code (leave empty to not change)",
    mode: "Mode",
    keepMode: "Do not change",
    submit: "Set up",
    confirm: serial => `Set up the unit ${serial}? The clock, the code and the mode are written to the unit.`,
    writing: "Setting up …",
    done: "Done. The unit read again:",
    codeResult: (before, after, ok) => `Code ${before} → ${after}${ok ? "" : " (the change did not go through)"}`,
    modeResult: (before, after, ok) => `Mode ${before} → ${after}${ok ? "" : " (the change did not go through)"}`,
    clockResult: diff => Math.abs(diff) < 2 ? "The clock matches the computer." : `The clock differs ${Math.round(diff)} s from the computer.`,
    noClock: "The clock could not be read afterwards."
  },
  register: {
    label: "Save in the club's unit register",
    none: "Do not save",
    saved: club => `Saved in ${club}'s unit register.`,
    failed: "Could not save in the unit register.",
    help: "Every unit read out or set up is saved with serial number, code, battery and clock (you need to be a leader or administrator in the club)."
  }
};

/** Engelska, arbetsytan del 13: Karta och vägval. */
export const raceMapEn: Texts<typeof raceMapSv> = {
  quota: quota => !quota ? "There is no room for more maps. Remove maps that are not used, or ask the server's owner to raise the limit."
    : quota.scope === "ACCOUNT"
      ? `The maps you have uploaded already take ${quota.usedMb} MB of your ${quota.limitMb} MB, and this one needs ${quota.neededMb} MB. ` +
        "Remove maps in events no longer used (copies and training sessions share the same file and cost nothing), " +
        "or ask the server's owner to raise the limit."
      : `The server has no room for more maps (${quota.usedMb} of ${quota.limitMb} MB used, this one needs ${quota.neededMb} MB). ` +
        "Ask the server's owner for more space.",
  title: "Map and route choice",
  help: "Upload the map, give where three points are and upload the runners' GPS routes (GPX). The route choices show in the public " +
    "split time analysis as soon as the map is georeferenced. The routes are linked to the legs with the punch times; only the part between " +
    "start and finish is shown.",
  analysisLink: "Show the split time analysis",
  loading: "Fetching map and routes…",
  loadFailed: "Map and routes could not be fetched.",
  retry: "Try again",
  map: {
    heading: "1. Map image",
    file: "Map image (PNG or JPEG, at most 30 MB)",
    fileHelp: "Export the map with the courses from OCAD, Purple Pen or Condes, or scan it.",
    none: "No map uploaded yet. Upload the map image when the courses are ready.",
    upload: "Upload map", replace: "Replace map", remove: "Remove the map",
    current: (fileName, width, height) => `${fileName} · ${width} × ${height} px`,
    georeferenced: "Georeferenced", notGeoreferenced: "Not georeferenced yet",
    saved: "The map is uploaded. Give the three points below.",
    removed: "The map is removed. The routes stay but are not shown until a new map is georeferenced.",
    chooseFile: "Choose an image first.",
    tooLarge: "The image is larger than 30 MB.",
    invalid: "The file is not a PNG or JPEG image.",
    failed: "The map could not be saved.",
    replacesMapFile: "A new map image replaces the map file."
  },
  mapFile: {
    upload: "Upload map file (OCAD or Mapper)",
    replace: "Replace map file",
    file: "Map file (.ocd, .omap or .xmap, at most 75 MB)",
    fileHelp: "The map is drawn in your browser. If the map is georeferenced in the file it lands right directly, otherwise you set three points below.",
    chooseFile: "Choose a map file first.",
    tooLarge: "The map file is larger than 75 MB.",
    reading: "Reading the map file …",
    drawing: "Drawing the map …",
    saving: "Saving the map …",
    saved: "The map is drawn and saved.",
    savedNeedsPoints: "The map is drawn and saved. The file lacks a georeference O-Tid can use, so give three points below.",
    errors: {
      NOT_A_MAP_FILE: "The file is not a map file from OCAD or Mapper.",
      UNSUPPORTED_VERSION: "The map file is from an OCAD version that is not supported (older than OCAD 8). Open and save it in newer OCAD or in Mapper.",
      TRUNCATED: "The map file is truncated or broken.",
      INVALID: "The map file cannot be read.",
      EMPTY: "The map file contains no objects to draw.",
      NO_CANVAS: "The browser cannot draw the map. Try a newer browser.",
      TOO_LARGE: "The map becomes too large as an image.",
      FAILED: "The map file could not be drawn."
    },
    invalid: "The server did not accept the map file. Check that it is a map file from OCAD or Mapper.",
    failed: "The map file could not be saved.",
    download: "Download the map file",
    summary: {
      format: (format, version) => {
        const name = format === "OCD" ? "OCAD" : "Mapper";
        return version.toLowerCase().startsWith(name.toLowerCase()) ? version : `${name} ${version}`;
      },
      scale: scale => `1:${scale.toLocaleString("en-GB")}`,
      crs: code => code === 3006 ? "SWEREF 99 TM" : code === 3021 ? "RT 90 2.5 gon V"
        : code !== null && code >= 3007 && code <= 3018 ? "SWEREF 99 local zone" : code !== null ? `EPSG ${code}` : "Unknown coordinate system",
      noCrs: "No georeference in the file",
      objects: count => count === 1 ? "1 object" : `${count.toLocaleString("en-GB")} objects`,
      fromFile: "Georeferenced from the file",
      setPoints: "Set three points",
      simplifications: "Simplified in the image"
    }
  },
  georeference: {
    heading: "2. Georeference",
    help: "Choose a point, click on the map where you know where it is (e.g. a road crossing or a corner of the map) and write the " +
      "coordinate. The coordinate can be copied from a web map, e.g. by right-clicking in Google Maps. Choose points far " +
      "from each other and not on a straight line.",
    point: index => `Point ${index + 1}`,
    choose: index => `Place point ${index + 1} on the map`,
    pixelX: "x (px)", pixelY: "y (px)",
    coordinate: "Coordinate (lat, lon)",
    coordinatePlaceholder: "59.33012, 18.06021",
    mapImage: "The map. Click to place the chosen point.",
    save: "Save georeference",
    saved: "The georeference is saved. The route choices now show in the split time analysis.",
    incomplete: "Place all three points and write the coordinates (latitude, longitude).",
    invalid: "The points cannot be used. Choose three points that are not on a straight line and check the coordinates.",
    failed: "The georeference could not be saved.",
    imageFailed: "The map image could not be shown."
  },
  routes: {
    heading: "3. Routes",
    help: "Choose the runner and the GPX file from the watch or the app (Garmin, Strava, Suunto and others). A new file replaces the previous one.",
    runner: "Runner", chooseRunner: "Choose runner",
    file: "GPX file",
    upload: "Upload route",
    saved: (name, covered, legs) => legs === 0
      ? `The route for ${name} is saved. It is linked to the legs when the runner has a result.`
      : `The route for ${name} is saved and covers ${covered} of ${legs} legs.`,
    chooseBoth: "Choose runner and GPX file.",
    invalid: "The file is not a GPX route that can be read.",
    noTimes: "The route has no times. Upload the GPX file from the watch or the app, not a drawn route.",
    notIndividual: "Routes can only be uploaded for individual runners, not relay runners.",
    failed: "The route could not be saved.",
    removed: "The route is removed.",
    none: "No routes uploaded yet.",
    table: "Uploaded routes",
    columns: { runner: "Runner", className: "Class", file: "File", covered: "Covers", actions: "Action" },
    covered: (covered, legs) => legs === 0 ? "No result yet" : `${covered} of ${legs} legs`,
    remove: "Remove",
    removeLabel: name => `Remove the route for ${name}`,
    noMapYet: "The routes show when the map is uploaded and georeferenced."
  }
};

const mapsEn = (count: number) => plural(count, "map", "maps");
const variantNameEn = (code: string | null) => code ?? "no variant";

/** Engelska, arbetsytan del 13: kartor till starten. */
export const mapBundlesEn: Texts<typeof mapBundlesSv> = {
  title: "Maps for the start",
  pageHelp: "Here you see how many maps each variant needs, in which order they should lie at the start and which runner gets which map, also the relay's teams and legs. The maps are printed in course setting, one map per runner in the same order, as a PDF for the printer or the office printer.",
  printLink: "Print one map per runner",
  checkLink: "Check the link",
  leg: leg => `leg ${leg}`,
  teamLeg: (team, leg) => leg !== undefined ? `team ${team}, leg ${leg}` : `team ${team}`,
  back: "Back to the workspace",
  loading: "Loading the maps …",
  loadError: "The maps could not be loaded. Try again.",
  retry: "Try again",
  link: "Maps for the start",
  linkHelp: "Print count per variant, the maps in start order and backs per runner.",
  views: { COUNTS: "Print count", BUNDLE: "Maps in order", BACKS: "Backs" },
  countsTitle: "Print count per variant",
  countsHelp: "Runners with the variant, free start times (so that late entries get a map) and reserve.",
  reserve: "Reserve per variant",
  reserveKinds: { PERCENT: "percent", COUNT: "maps" },
  reserveSave: "Save the reserve",
  reserveSaved: "The reserve is saved.",
  reserveError: "The reserve could not be saved. Try again.",
  reserveInvalid: "Give a whole number between 0 and 1000.",
  course: "Course", variant: "Variant", runners: "Runners", vacancies: "Free times", reserveColumn: "Reserve", print: "To print",
  noVariant: "–",
  total: "Total",
  missingVariantTitle: count => `${plural(count, "runner is", "runners are")} missing a variant and get no map yet`,
  missingVariantHelp: "Distribute the forkings under Classes first.",
  bundleTitle: "Maps in order",
  bundleHelp: "The maps in the order they should lie at the start.",
  orderLabel: "Order",
  order: { TIME: "By start time", CLASS: "By class and variant (mass start)" },
  number: "No", name: "Name", club: "Club", className: "Class", startTime: "Start",
  vacant: "Free time",
  freeStart: "Free start",
  bundleEmpty: "No maps to lay out yet.",
  printList: "Print",
  csv: "Save as CSV",
  csvHeader: ["No", "Start time", "Class", "Course", "Variant", "Name", "Club"],
  csvFile: "map-bundle-list",
  printedAt: time => `Printed ${time}`,
  notPrinted: "Not printed yet.",
  changesSince: (count, time) => count === 1 ? `1 change since the list was printed ${time}` : `${count} changes since the list was printed ${time}`,
  noChanges: time => `No changes since the list was printed ${time}.`,
  printChanged: "The list has changed since it was loaded. It is loaded again; look at the changes and print once more.",
  printError: "The printout could not be saved. Try again.",
  change: (change, clock) => {
    switch (change.kind) {
      case "ADDED": return `New: ${change.name} (${change.className}${change.variantCode ? `, ${change.variantCode}` : ""})`;
      case "REMOVED": return `Removed: ${change.name} (${change.className})`;
      case "VARIANT": return `${change.name} (${change.className}): ${variantNameEn(change.from)} → ${variantNameEn(change.to)}`;
      case "CLASS": return `${change.name}: ${change.from} → ${change.to}`;
      case "START_TIME": return `${change.name} (${change.className}): start ${clock(change.from)} → ${clock(change.to)}`;
      case "COUNT": return `${change.courseName}${change.variantCode ? ` ${change.variantCode}` : ""}${change.layout ? ` (${change.layout})` : ""}: ${mapsEn(change.from)} → ${mapsEn(change.to)}`;
      case "NUMBERS": return change.count === 1 ? "1 runner has a new number" : `${change.count} runners have new numbers`;
    }
  },
  backsTitle: "Backs per runner",
  backsHelp: "One page per map in the same order as the variant's map bundle, with reserve pages so that the number of pages is the print count. Run the printed bundle through the printer again for the back, or use the page as a cover.",
  paper: "Paper",
  papers: { A4: "A4", A3: "A3" },
  orientation: "Orientation",
  orientations: { portrait: "Portrait", landscape: "Landscape" },
  position: "Text position",
  positions: { TOP_LEFT: "Top left", TOP_RIGHT: "Top right", CENTER: "Centre", BOTTOM_LEFT: "Bottom left", BOTTOM_RIGHT: "Bottom right" },
  mirror: "Mirror for the back (the text ends up behind the same corner of the map)",
  testPage: "Print a test page",
  printBacks: "Print the backs",
  testPageText: "Test page – the text ends up here",
  divider: (variant, count) => `${variant ? `Variant ${variant}` : "Without variant"} · ${mapsEn(count)}`,
  dividerHelp: variant => `Put map bundle ${variant ?? "without variant"} here`,
  reservePage: variant => variant ? `Reserve · variant ${variant}` : "Reserve",
  vacantPage: time => `Free time ${time}`,
  vacantName: "Free",
  reserveName: "Reserve",
  backsFromCourseSetting: "The texts follow the back as set in course setting (Printing → back per runner).",
  pages: count => plural(count, "page", "pages")
};
