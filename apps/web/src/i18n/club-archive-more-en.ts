import type { ClubMapCheckStatus } from "@o-tid/contracts";
import { mb } from "@o-tid/club-archive";
import type { Texts } from "../lib/language";
import type { clubArchiveChecksSv } from "./club-archive-checks-sv";
import type { clubDevicesSv } from "./club-devices-sv";
import type { clubWebImportSv } from "./club-import-web-sv";

/** Engelska del 34: kontrollen av kartorna, enhetsregistret och importen i webbläsaren. */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const clubArchiveChecksEn: Texts<typeof clubArchiveChecksSv> = {
  status: {
    OK: "Works",
    UNSUPPORTED_VERSION: "The version is not supported",
    NOT_A_MAP_FILE: "Not a map file",
    TRUNCATED: "The file is damaged",
    INVALID: "The file is damaged",
    EMPTY: "The map is empty",
    TOO_LARGE: "Too large to be drawn here",
    FAILED: "Could not be drawn"
  } satisfies Record<ClubMapCheckStatus, string>,
  notChecked: "Not checked yet",
  checking: "Checking …",
  explain: {
    OK: "",
    UNSUPPORTED_VERSION: "The map file is from a version O-Tid cannot read. Open it and save it in a newer OCAD or in Mapper.",
    NOT_A_MAP_FILE: "The file is neither an OCAD nor a Mapper map.",
    TRUNCATED: "The file is truncated or broken. Download the original and try opening it in OCAD or Mapper.",
    INVALID: "The file is broken. Download the original and try opening it in OCAD or Mapper.",
    EMPTY: "The map file has no objects O-Tid can draw.",
    TOO_LARGE: "The map got too large to be drawn in the browser.",
    FAILED: "The map could not be drawn in the browser. Download the original and open it in OCAD or Mapper."
  } satisfies Record<ClubMapCheckStatus, string>,
  works: (fileVersion: string | null) => fileVersion ? `Works · ${fileVersion}` : "Works",
  mapImage: (name: string) => `The map ${name}`,
  noImage: "No image yet",
  trainingImage: (title: string) => `The course on the map: ${title}`,
  trainingNoMap: "No map",
  trainingMapFailed: "The map could not be drawn",
  previewFailed: (reason: string) => `The map could not be drawn here: ${reason}`,
  previewDownload: "Download the original and open it in OCAD or Mapper.",
  recheckAll: "Check all maps again",
  recheckHelp: "Reads every map version again, draws the images of the maps and the trainings and recalculates the course files' summaries. It is done in this browser and can take a while.",
  progress: (done: number, total: number, label: string) => `Checking ${done + 1} of ${total}: ${label}`,
  progressAuto: (done: number, total: number) => `Drawing images of the maps (${done} of ${total}) …`,
  finished: (versions: number, failed: number) => failed === 0
    ? `Done. ${count(versions, "map version works", "map versions work")}.`
    : `Done. ${versions - failed} of ${versions} map versions work; see the reasons by the versions.`,
  stopped: "The check was stopped. What was finished is saved.",
  summariesFailed: "The course files' summaries could not be recalculated.",
  rights: {
    edit: "Change rights",
    title: (name: string) => `The map's rights: ${name}`,
    save: "Save the rights",
    cancel: "Cancel",
    saved: "The rights are saved.",
    help: "Applies to the map in all versions and follows along when the map is used in a group or an event."
  }
};

export const clubDevicesEn: Texts<typeof clubDevicesSv> = {
  help: "The club's SPORTident units. A unit is saved here when it is read out or set up during an event (Readout → Read out units) with the club chosen. "
    + "The battery's age is counted from the change date the unit gives; SPORTident expects 3–5 years for BSF8 and 4–7 years for BSF7.",
  none: "No units yet. Read out a unit during an event and choose the club to save it here.",
  count: (n: number) => count(n, "unit", "units"),
  columns: { code: "Code", serial: "Serial number", model: "Model", mode: "Mode", battery: "Battery changed", clock: "Clock", read: "Last read", note: "Note" },
  batteryAge: (years: number) => years < 1 ? "under a year" : `${years.toLocaleString("en-GB", { maximumFractionDigits: 1 })} years`,
  batteryOld: "check",
  clock: (ms: number | null) => ms === null ? "–" : Math.abs(ms) < 2000 ? "was right" : `${ms > 0 ? "+" : "−"}${Math.round(Math.abs(ms) / 1000)} s`,
  read: (date: string, by: string | null) => `${date}${by ? `, ${by}` : ""}`,
  noteLabel: (serial: number) => `Note for ${serial}`,
  save: "Save",
  remove: "Remove",
  removeConfirm: (serial: number) => `Remove the unit ${serial} from the register?`,
  failed: "That did not work. Try again.",
  loading: "Fetching the units …",
  modes: { 2: "Control", 3: "Start", 4: "Finish", 5: "Readout", 7: "Clear", 10: "Check" }
};

export const clubWebImportEn: Texts<typeof clubWebImportSv> = {
  title: "Import the club's old trainings",
  intro: "Choose the folder with the trainings, or the zip files you downloaded from Google Drive. O-Tid finds maps and course files and shows what it finds before anything is sent.",
  privacy: "PDF, Word, Excel, images, start lists and results are never opened and never leave your computer. Only map files (.ocd, .omap, .xmap) and course files (.ppen, IOF CourseData) are sent.",
  chooseFolder: "Choose folder",
  chooseFiles: "Choose files",
  drop: "… or drag folders and zip files here.",
  dropActive: "Drop to add.",
  folderHint: "Choose the folder with the year folders (2018, 2019 …), or a single year folder. The year comes along in both cases.",
  phoneNote: "The import works best on a computer. There you can choose the whole folder with the club's trainings.",
  chosenTitle: "Chosen",
  chosenFolder: (name: string, files: number) => `The folder ${name} (${count(files, "file", "files")})`,
  chosenFile: (name: string, bytes: number) => `${name} (${mb(bytes)})`,
  clear: "Clear",
  leaders: "Do not include the leader's name from [square brackets]",
  leadersHint: "The leaders' names in the folder names are personal data. In the command the same choice is called",
  preview: "Preview",
  scanning: (done: number, total: number) => `Reading ${done} of ${total} files …`,
  opening: "Opening the files …",
  checking: "Asking the server what already exists …",
  cancel: "Cancel",
  start: "Import",
  startAgain: "Import again",
  report: "Download the report",
  chooseOther: "Choose other files",
  previewTitle: "Preview – nothing is sent yet",
  trainings: (n: number) => `${count(n, "training", "trainings")} found`,
  trainingsNew: (fresh: number, existing: number) => existing === 0 ? "All are new." : `${fresh} new, ${existing} already in the archive.`,
  statusLine: (n: number, label: string) => `${n} – ${label}`,
  maps: (files: number, maps: number, bytes: number) => `${count(files, "map file", "map files")} in ${count(maps, "map", "maps")} (${mb(bytes)})`,
  mapsNew: (upload: number, bytes: number, known: number) => upload === 0 ? "The server already has all the map files."
    : `${upload} will be uploaded (${mb(bytes)})${known > 0 ? `, ${known} already on the server` : ""}.`,
  courses: (ppen: number, courseData: number, bytes: number) => `Course files: ${ppen} .ppen and ${courseData} CourseData (${mb(bytes)})`,
  quota: (used: number, adding: number, limit: number | null) => limit === null
    ? `Your space for maps: ${mb(used)} used, the import adds ${mb(adding)} (no limit).`
    : `Your space for maps: ${mb(used)} of ${mb(limit)} used, the import adds ${mb(adding)}.`,
  quotaFull: (missing: number) => `It does not fit: ${mb(missing)} too much. Remove maps you do not need or import fewer folders.`,
  nothingNew: "There is nothing new to import. Everything is already in the archive.",
  notSentTitle: "Not sent (never opened)",
  notSentLine: (n: number, label: string, bytes: number) => `${n} ${label} (${mb(bytes)})`,
  notSentNone: "No other files.",
  showFiles: (n: number) => `Show the files that are not sent (${n})`,
  more: (n: number) => `… and ${n} more`,
  problemsTitle: "To look at",
  mapMissing: (n: number) => `${count(n, "training has", "trainings have")} courses but the map was not found. The courses are imported anyway; the map can be chosen in the archive afterwards.`,
  emptyFolders: (n: number) => `${count(n, "folder", "folders")} without maps and courses ${n === 1 ? "is" : "are"} skipped.`,
  showList: "Show which",
  mapTooLarge: (path: string, bytes: number, limit: number) =>
    `${path}: the map file is ${mb(bytes)}, but at most ${mb(limit)} may be uploaded. It is not sent. Save the map smaller (e.g. without a background image) and import again.`,
  nothingFound: "No map files or course files were found. Did you choose the right folder?",
  progressTitle: "Importing",
  checkingServer: "Asking the server …",
  progressMap: (index: number, total: number, name: string, bytes: number) => `Map ${index} of ${total} – ${name} (${mb(bytes)}) …`,
  progressVersions: (index: number, total: number) => `The maps' versions ${index} of ${total} …`,
  progressTrainings: (done: number, total: number) => `Training ${done} of ${total} …`,
  leaveWarning: "The import is running. If you leave the page it is stopped (what was sent remains).",
  done: (uploaded: number, skipped: number, created: number, existing: number, courses: number) =>
    `Done: ${uploaded} map files uploaded (${skipped} already existed), ${created} new trainings (${existing} already existed), ${courses} new course files.`,
  cancelled: "The import was stopped. What was sent remains. Press ”Import” again and it continues where it stopped.",
  failed: (reason: string) => `The import stopped: ${reason} What was sent remains; press ”Import” again when the error is fixed.`,
  readFailed: (reason: string) => `The files could not be read: ${reason}`,
  errors: {
    session: "You are no longer signed in. Sign in again in another tab and press Import again.",
    forbidden: "Only the club's owners and administrators import.",
    notFound: "The club does not exist, or you are not a member of it.",
    tooLarge: (name: string) => `${name} is too large for the server.`,
    quota: "Your space for maps on the server is full.",
    hashMismatch: (name: string) => `${name} changed while it was being sent. Choose the files again.`,
    invalidMap: (name: string) => `${name} does not look like a map file from OCAD or Mapper.`,
    network: "The connection with the server was lost.",
    generic: (status: number) => `The server answered ${status}.`
  },
  cliTitle: "For those who know Git: the command line",
  webOnlyAdmins: "Only the club's owners and administrators import."
};
