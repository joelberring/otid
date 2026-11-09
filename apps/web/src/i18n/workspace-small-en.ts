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
