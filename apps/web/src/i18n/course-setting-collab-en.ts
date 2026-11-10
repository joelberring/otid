import type { Texts } from "../lib/language";
import type { collaborationSv } from "./course-setting-collaboration-sv";
import type { offlineSv } from "./course-setting-offline-sv";

/** Engelska del 28: samarbetet i banläggningen (arbetssätt, flikar, notiser, förslag) och fältläget utan nät. */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const time = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
const clock = (value: string) => new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const when = (value: string) => {
  const date = new Date(value);
  const today = new Date().toDateString() === date.toDateString();
  return today ? clock(value) : date.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
const megabytes = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} kB`
  : `${(bytes / 1024 / 1024).toLocaleString("en-GB", { maximumFractionDigits: 1 })} MB`;
const reason = (status: number) => status === 409 ? "the control or the course no longer exists" : `response ${status}`;
const changes = (n: number) => count(n, "change", "changes");

export const collaborationEn: Texts<typeof collaborationSv> = {
  access: {
    EDIT: "You can edit the courses",
    SUGGEST: "You can suggest changes",
    COMMENT: "You can read and comment"
  },
  mode: {
    heading: "Way of working",
    label: "How you work",
    LEAD: "Lead course setter",
    SHARED: "Shared",
    help: {
      LEAD: "Those with edit access change directly; others suggest changes that the lead course setter approves.",
      SHARED: "Everyone with edit access changes directly; the notes are used for discussion. Those who suggest do so here too."
    },
    saved: "The way of working is saved.",
    failed: "The way of working could not be saved."
  },
  presence: (names: readonly string[]) => names.length === 0 ? "" : `Here now: ${names.join(", ")}`,
  someone: "Someone",
  waitForMap: "The owner or an administrator uploads the map file. The page shows the course setting once it exists.",
  waitForStart: "The course setting has not been started yet. Someone with edit access imports a .ppen or starts empty.",
  remoteChanged: (name: string, kept: boolean) => `${name} changed the courses.${kept ? " Your unsaved changes are kept." : ""}`,
  lost: (n: number) => `${changes(n)} could not be saved after other people's changes:`,
  topbar: {
    course: "Show course",
    variant: "Variant",
    file: "File",
    fileMenu: "File and versions …",
    transfer: "Transfer to the event …",
    settings: "Way of working …",
    fullscreen: "Full screen",
    exitFullscreen: "Exit full screen",
    close: "Close",
    menu: "Menu"
  },
  drawer: {
    label: "Panels",
    collapse: "Collapse the panels",
    expand: "Show the panels",
    resize: "Change the panels' width",
    more: "More",
    tabs: { courses: "Courses", description: "Description", selected: "Selected", objects: "Objects", training: "Training", print: "Print",
      checks: "Warnings", notes: "Notes", inspections: "Checked", suggestions: "Suggestions", settings: "Settings" },
    count: (label: string, n: number) => n > 0 ? `${label} (${n})` : label
  },
  card: {
    label: "Selected on the map",
    description: "Description",
    more: "More",
    close: "Deselect"
  },
  notes: {
    heading: "Notes",
    show: "Show notes on the map",
    filter: "Show",
    filters: { OPEN: "Open", DONE: "Done", ALL: "All" },
    none: "No notes.",
    target: {
      POINT: "Point on the map",
      CONTROL: (label: string) => `Control: ${label}`,
      LEG: (from: string, to: string) => `Leg ${from}–${to}`,
      COURSE: (name: string) => `Course ${name}`
    },
    newHeading: "New note",
    newHelp: "Choose the Note tool and click on the map, a control or a leg. A note about the course is written here.",
    aboutCourse: (name: string) => `Note about the course ${name}`,
    text: "Text",
    photo: "Photo (optional)",
    photoHelp: "From the camera or an image. Reduced to at most 2 MB.",
    photoTooLarge: "The photo is too large even when reduced.",
    photoFailed: "The photo could not be read.",
    save: "Save the note",
    cancel: "Cancel",
    saving: "Saving …",
    failed: "The note could not be saved.",
    reply: "Reply",
    replyLabel: "Reply",
    sendReply: "Send the reply",
    done: "Done",
    reopen: "Reopen",
    status: { OPEN: "Open", DONE: "Done" },
    by: (name: string | null, at: string) => `${name ?? "Someone"}, ${time(at)}`,
    show_on_map: "Show on the map",
    photoAlt: "Photo for the note",
    replies: (n: number) => count(n, "reply", "replies"),
    mark: (n: number) => n === 1 ? "Note" : `${n} notes`
  },
  suggestions: {
    heading: "Suggestions",
    none: "No open suggestions.",
    drafting: "Suggestion mode",
    draftHelp: "Your changes are collected as a suggestion. Only you see them until you send the suggestion; someone with edit access approves it.",
    draftCount: (n: number) => n === 0 ? "No changes yet." : `${changes(n)} in the suggestion.`,
    comment: "Comment on the suggestion",
    send: "Send the suggestion",
    discard: "Discard the suggestion",
    discardConfirm: "Discard the changes in the suggestion?",
    sent: "The suggestion is sent.",
    failed: "The suggestion could not be sent.",
    open: (n: number) => count(n, "open suggestion", "open suggestions"),
    row: (name: string | null, at: string, n: number) => `${name ?? "Someone"}, ${time(at)} · ${changes(n)}`,
    status: { OPEN: "Open", APPROVED: "Approved", PARTIAL: "Partly approved", DECLINED: "Declined" },
    review: "Review",
    stopReview: "Stop reviewing",
    reviewing: "The suggestion is drawn dashed on top of the course: arrows for moved controls, dashed circles for new ones and crosses for removed ones.",
    pick: "Changes to approve",
    approveAll: "Approve all",
    approveSelected: (n: number) => `Approve ${count(n, "chosen change", "chosen changes")}`,
    decline: "Decline",
    declineComment: "Comment (to the person who suggested)",
    declined: "The suggestion is declined.",
    approved: (applied: number) => `${applied === 1 ? "1 change is" : `${applied} changes are`} made.`,
    notPossible: "No longer possible:",
    decisionFailed: "The decision could not be saved.",
    history: "Earlier suggestions",
    decisionBy: (name: string | null, at: string) => `${name ?? "Someone"}, ${time(at)}`
  }
};

export const offlineEn: Texts<typeof offlineSv> = {
  more: "More",
  status: {
    offline: (waiting: number) => waiting === 0 ? "No network" : `No network – ${changes(waiting)} waiting`,
    loggedOut: (waiting: number) => `Signed out – ${changes(waiting)} waiting on the phone`,
    sending: (waiting: number) => `Sending ${changes(waiting)} …`,
    storageFailed: (waiting: number) => `Cannot save on the phone${waiting > 0 ? ` – ${changes(waiting)} only in memory` : ""}. Sync with a network or free up space.`
  },
  storageFailed: "The phone could not save the changes (the storage may be full). Do not reload the page: connect to the network so the changes are saved on the server, or free up space (remove saved maps or images).",
  accessGone: "You no longer have access to the course setting. The copy on the phone is removed.",
  back: (parts: readonly string[]) => `The network is back: ${parts.join(", ")} saved.`,
  backEdits: (n: number) => count(n, "change on the map", "changes on the map"),
  backNotes: (n: number) => count(n, "note", "notes"),
  backInspections: (n: number) => count(n, "check mark", "check marks"),
  rejected: (n: number) => `${count(n, "thing", "things")} in the queue could not be saved:`,
  rejectedNote: (text: string, status: number) => `The note "${text.slice(0, 40)}" (${reason(status)})`,
  rejectedInspection: (label: string, status: number) => `Checked for ${label} (${reason(status)})`,
  loggedOut: (waiting: number) => `The sign-in has expired. ${changes(waiting)} remain on the phone and are sent when you have signed in again.`,
  login: "Sign in (new tab)",
  openedFromPhone: (at: string) => `No network: the course setting from the phone (saved ${when(at)}). The changes are sent when the network is back.`,
  resumed: (n: number) => `${changes(n)} from last time are being sent.`,
  olderMap: "The map file on the phone is an older version than the one on the server.",
  panel: {
    heading: "Without network",
    help: "Save the page and the map file on the phone before you go out. Changes, notes and check marks are always saved on the phone until the server has received them.",
    save: (size: number | undefined) => size === undefined ? "Save the map for offline" : `Save the map for offline (${megabytes(size)})`,
    saving: "Saving on the phone …",
    saved: (bytes: number, at: string) => `Saved on the phone ${when(at)}: the map file ${megabytes(bytes)} and the page.`,
    stale: "The map file on the server is new – save again.",
    update: "Save again",
    remove: "Remove from the phone",
    removed: "Removed from the phone.",
    failed: "Saving on the phone failed.",
    noShell: "The browser cannot save the page; the map and the changes are saved anyway.",
    shellFailed: "The page was not saved – the map file and the changes are on the phone anyway.",
    waiting: (n: number) => n === 0 ? "Nothing is waiting to be sent." : `${changes(n)} waiting to be sent.`,
    sendNow: "Send now"
  },
  inspection: {
    button: "Checked",
    checked: "Checked ✓",
    selected: (label: string) => `Mark ${label} as checked`,
    by: (name: string | null, at: string) => `Checked by ${name ?? "someone"} ${when(at)}`,
    pending: "waiting for network",
    sending: "sending …",
    movedSince: "moved after the check",
    notSaved: "The control is not saved yet – check it once it is saved.",
    heading: "Checked controls",
    filter: "Show",
    filters: { UNCHECKED: "Not checked", ALL: "All" },
    count: (checked: number, total: number) => `${checked} of ${total} checked`,
    none: "All controls are checked.",
    noControls: "No controls.",
    unchecked: "Not checked",
    help: "Tap a control to show it on the map. Mark it in the field with Checked.",
    tab: "Checked"
  },
  noteHere: {
    button: "Note here",
    heading: (target: string) => `Note: ${target}`,
    atPosition: "your position",
    retake: "New photo",
    takePhoto: "Take photo",
    photoReady: "Photo attached",
    text: "Text (optional with a photo)",
    save: "Save the note",
    cancel: "Cancel",
    photoOnly: "Photo",
    queued: "The note is saved on the phone and sent when there is a network.",
    saved: "The note is saved."
  },
  list: "List",
  offlineButton: "Offline",
  follow: "Following",
  poorAccuracy: (meters: number) => `Position ±${meters} m – uncertain (worse than 15 m). Wait a while or go out into the open.`,
  movedPoor: (meters: number) => `Moved, but the accuracy was only ±${meters} m – check against the map.`
};
