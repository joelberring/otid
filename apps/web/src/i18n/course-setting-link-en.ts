import type { Texts } from "../lib/language";
import type { mapLinkSv } from "./map-link-sv";
import type { courseDataSv, courseSettingRaceTypeSv } from "./course-data-sv";
import { courseDataOfferEn } from "./workspace-last-en";

/** Engelska del 31: länken till kartritaren och kartritarens sida, banfilen i banläggningen och tävlingstypernas besked. */
const time = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const mapLinkEn: Texts<typeof mapLinkSv> = {
  time,
  share: {
    heading: "Share with the mapper",
    intro: "The mapper opens the map errors with a link, without an account and without seeing the courses. They can reply and say whether the map error is fixed.",
    open: "Share with the mapper",
    limit: "Limit the time",
    lastDay: "Valid up to and including",
    showRaceName: "Show the event's name",
    showRaceNameHelp: "Otherwise the page only says ”Map errors”.",
    create: "Create the link",
    cancel: "Cancel",
    copy: "Copy the link",
    copied: "The link is copied.",
    copyFailed: "Copy the link by hand.",
    linkLabel: "The link for the mapper",
    shownOnce: "The link is only shown now. Send it to the mapper. If you need it again: create a new link (this one then stops working).",
    activeUntil: (iso: string) => `The link is valid up to and including ${day(new Date(new Date(iso).getTime() - 1).toISOString())}.`,
    activeForever: "The link is valid until you turn it off.",
    expired: "The link has expired. Create a new one if the mapper needs it.",
    lastOpenedLabel: "Last opened",
    lastOpened: (iso: string) => `Last opened ${time(iso)}.`,
    neverOpened: "Not opened yet.",
    withRaceName: "The event's name is shown.",
    revoke: "Turn off the link",
    regenerate: "Create new link",
    revokeConfirm: "Turn off the link? The mapper can no longer open it.",
    regenerateConfirm: "Create a new link? The old one stops working at once.",
    revoked: "The link is turned off.",
    near: (n: number) => `${count(n, "map error is", "map errors are")} close to a control. The mapper sees all map errors with the link.`,
    failed: "Saving failed. Try again.",
    loading: "Reading the link …"
  },
  page: {
    title: "Map errors",
    intro: "The map errors the course setters have found. Tap a map error to read the thread, reply or say whether it is fixed.",
    invalidTitle: "The link is not valid",
    invalid: "The link is no longer valid – ask the course setter for a new one.",
    rateLimited: "Too many attempts from this address. Try again in a while.",
    list: "The map errors",
    none: "No map errors right now.",
    number: (number: number) => `Map error ${number}`,
    status: { OPEN: "Open", DONE: "Fixed" },
    replies: (n: number) => count(n, "reply", "replies"),
    mapMaker: "The mapper",
    courseSetter: "The course setter",
    name: "Your name (optional)",
    nameHelp: "Shown on your replies. Otherwise it says The mapper.",
    reply: "Reply",
    sendReply: "Send the reply",
    verdictNote: "Comment (optional)",
    fixed: "Fixed in the map",
    notFixed: "Not fixed",
    verdicts: { FIXED: "Fixed in the map", NOT_FIXED: "Not fixed" },
    close: "Close",
    saveFailed: "Saving failed. Try again.",
    mapLoading: "Reading the map …",
    mapFailed: "The map could not be drawn. The map errors are in the list.",
    noMap: "There is no map file. The map errors are in the list.",
    mapLabel: "The map with the map errors",
    position: "My position",
    positionOff: "Hide my position",
    noGeoref: "The map file has no georeference, so your position cannot be shown.",
    insecure: "The position needs a secure connection (https).",
    noGeolocation: "The phone or the browser cannot give a position.",
    denied: "The position is not allowed. Allow location services for the page in the browser.",
    positionFailed: "The position could not be read right now.",
    outside: "You are outside the map.",
    accuracy: (meters: number) => `The position ±${meters} m.`,
    unsupportedCrs: "The map's coordinate system is not supported for the position."
  },
  edit: {
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
    edited: (iso: string) => `(edited ${time(iso)})`,
    conflict: "Someone else has changed the text. The new text is shown; try again.",
    failed: "The change was not saved. Try again.",
    label: "Text"
  }
};

export const courseDataEn: Texts<typeof courseDataSv> = {
  offer: courseDataOfferEn,
  problems: {
    invalid: "The course file could not be read as courses on the map.",
    noScale: "The course file does not give the map's scale.",
    notPlaced: (detail: string) => `${detail.replace(/\.$/, "")}. The courses cannot be put on the map.`
  },
  fromCourseData: (courses: number, controls: number) =>
    `The courses come from the course file (${count(courses, "course", "courses")}, ${count(controls, "control", "controls")}). The control descriptions are empty.`,
  saveFailed: "The change was not saved – try again.",
  retry: "Try again",
  startConflict: "Someone else started the course setting at the same time, so the file was not imported. Import it under File if it should replace the courses."
};

export const courseSettingRaceTypeEn: Texts<typeof courseSettingRaceTypeSv> = {
  ROGAINING: "Rogaining: new courses become score courses. Without set points, the control code's first digit gives the points (IRF rule C9). The points follow along when you transfer to the event.",
  PARTY: "Party: the course setting gives maps to print. The party has no courses in the event, so Transfer to the event is not available here."
};
